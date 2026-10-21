// Server-side Umami events. No script reaches visitors and no cookies are set; nothing is sent when UMAMI_WEBSITE_ID is empty.
const WEBSITE_ID = process.env.UMAMI_WEBSITE_ID ?? "";
const ENDPOINT = `${(process.env.UMAMI_URL ?? "https://cloud.umami.is").replace(/\/+$/, "")}/api/send`;
const HOSTNAME = new URL(process.env.PUBLIC_URL ?? "https://fxalza.cz").hostname;
const MAX_IN_FLIGHT = 50;
// Umami drops requests whose user agent looks like a bot, so crawlers are reported under this one and their real name goes into the event data.
const SERVER_UA = "Mozilla/5.0 (compatible; fxalza-server/1.0)";

const PLATFORMS: [RegExp, string][] = [
  [/Discordbot/i, "discord"],
  [/TelegramBot/i, "telegram"],
  [/Slackbot/i, "slack"],
  [/facebookexternalhit|meta-externalagent|Facebot/i, "facebook"],
  [/WhatsApp/i, "whatsapp"],
  [/Twitterbot/i, "x"],
  [/LinkedInBot/i, "linkedin"],
];

export function platformOf(userAgent: string): string {
  return PLATFORMS.find(([re]) => re.test(userAgent))?.[1] ?? "other";
}

export interface TrackEvent {
  url: string;
  name?: string;
  data?: Record<string, string | number | boolean>;
  visitorUa?: string;
  referrer?: string;
  language?: string;
  country?: string;
}

let inFlight = 0;
let lastError = 0;

export function track(e: TrackEvent): void {
  if (!WEBSITE_ID || inFlight >= MAX_IN_FLIGHT) return;
  inFlight++;
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": e.visitorUa || SERVER_UA,
      // Umami reads the CDN country header before it looks the address up, so no address has to be sent for the Countries report.
      ...(e.country ? { "cf-ipcountry": e.country } : {}),
    },
    body: JSON.stringify({
      type: "event",
      payload: {
        website: WEBSITE_ID,
        hostname: HOSTNAME,
        url: e.url,
        ...(e.name ? { name: e.name } : {}),
        ...(e.data ? { data: e.data } : {}),
        ...(e.referrer ? { referrer: e.referrer } : {}),
        ...(e.language ? { language: e.language } : {}),
      },
    }),
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
    })
    .catch((err) => {
      if (Date.now() - lastError > 60_000) {
        lastError = Date.now();
        console.warn(`[umami] event not delivered: ${err instanceof Error ? err.message : err}`);
      }
    })
    .finally(() => {
      inFlight--;
    });
}

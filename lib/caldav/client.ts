import { createDAVClient } from "tsdav";

type DAVClientInstance = Awaited<ReturnType<typeof createDAVClient>>;

let _client: DAVClientInstance | null = null;

export async function getCalDAVClient(): Promise<DAVClientInstance> {
  if (_client) return _client;
  _client = await createDAVClient({
    serverUrl: process.env.CALDAV_URL ?? "https://caldav.icloud.com",
    credentials: {
      username: process.env.CALDAV_USERNAME!,
      password: process.env.CALDAV_PASSWORD!,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
  return _client;
}

export function isCalDAVConfigured(): boolean {
  return !!(process.env.CALDAV_USERNAME && process.env.CALDAV_PASSWORD);
}

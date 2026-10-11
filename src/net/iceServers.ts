//
// iceServers.ts
//--------------------
// How browsers find a path to each other. STUN lets most networks connect directly; when a network blocks
// direct peer-to-peer (campus Wi-Fi, hotspots, strict routers), a TURN relay carries the traffic instead.
//
// Relay: Metered (https://www.metered.ca/stun-turn). Either list static TURN servers in TURN_SERVERS, or set
// TURN_CREDENTIALS_URL to the app's credentials API URL (…/api/v1/turn/credentials?apiKey=…), whose key can be
// restricted to the site's domain. Both end up in the public site.
//

export const TURN_CREDENTIALS_URL = "";

const METERED_USER = "e07b14ed405e768bfd2394f2";
const METERED_PASS = "/Jt1jwIl3QHK6N7w";
const TURN_SERVERS: RTCIceServer[] = [
	{ urls: "stun:stun.relay.metered.ca:80" },
	{ urls: "turn:global.relay.metered.ca:80", username: METERED_USER, credential: METERED_PASS },
	{ urls: "turn:global.relay.metered.ca:80?transport=tcp", username: METERED_USER, credential: METERED_PASS },
	{ urls: "turn:global.relay.metered.ca:443", username: METERED_USER, credential: METERED_PASS },
	{ urls: "turns:global.relay.metered.ca:443?transport=tcp", username: METERED_USER, credential: METERED_PASS },
];

const STUN_SERVERS: RTCIceServer[] = [
	{ urls: "stun:stun.l.google.com:19302" },
	{ urls: "stun:stun1.l.google.com:19302" },
	{ urls: "stun:stun.cloudflare.com:3478" },
	{ urls: "stun:global.stun.twilio.com:3478" },
];

let cached: Promise<RTCConfiguration> | null = null;

/** `?relay=1` in the page URL forces all traffic through the relay (for testing it). */
function forceRelay() {
	return new URLSearchParams(location.search).get("relay") === "1";
}

export function hasRelay() {
	return TURN_CREDENTIALS_URL !== "" || TURN_SERVERS.length > 0;
}

export function rtcConfig(): Promise<RTCConfiguration> {
	if (!cached) cached = load();
	return cached;
}

async function load(): Promise<RTCConfiguration> {
	if (!hasRelay()) return { iceServers: STUN_SERVERS };
	if (!TURN_CREDENTIALS_URL) {
		return { iceServers: [...STUN_SERVERS, ...TURN_SERVERS], iceTransportPolicy: forceRelay() ? "relay" : "all" };
	}
	try {
		const resp = await fetch(TURN_CREDENTIALS_URL);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const turn = (await resp.json()) as RTCIceServer[];
		return {
			iceServers: [...STUN_SERVERS, ...turn],
			iceTransportPolicy: forceRelay() ? "relay" : "all",
		};
	} catch (e) {
		console.warn("TURN relay unavailable, using direct connections only:", e);
		cached = null; // try again next time
		return { iceServers: STUN_SERVERS };
	}
}

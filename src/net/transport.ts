//
// transport.ts
//--------------------
// Peer-to-peer rooms over WebRTC (PeerJS). The host's peer id is derived from the room code; guests
// connect only to the host, and the host relays broadcast messages between guests (star topology).
// The free public PeerJS server is only used to find each other; game traffic goes peer to peer.
//

import Peer, { DataConnection } from "peerjs";
import { hasRelay, rtcConfig } from "./iceServers";

export type NetMsg = { t: string; [k: string]: unknown };

const ID_PREFIX = "mkdsweb-room-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
/** ICE can take a while when it has to fall back to the relay. */
const CONNECT_TIMEOUT_MS = 25000;

function randomCode(len = 5) {
	let s = "";
	for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
	return s;
}

export class NetTransport {
	readonly isHost: boolean;
	readonly code: string;
	/** This client's peer id (the host's is ID_PREFIX + code). */
	readonly myId: string;
	onMessage: (msg: NetMsg, from: string) => void = () => {};
	onPeerLeave: (peerId: string) => void = () => {};
	onClose: (reason: string) => void = () => {};

	private _peer: Peer;
	private _conns = new Map<string, DataConnection>();
	private _closed = false;

	private constructor(peer: Peer, isHost: boolean, code: string) {
		this._peer = peer;
		this.isHost = isHost;
		this.code = code;
		this.myId = peer.id;
	}

	static async host(): Promise<NetTransport> {
		const config = await rtcConfig();
		return new Promise((resolve, reject) => {
			const code = randomCode();
			const peer = new Peer(ID_PREFIX + code, { config });
			const timer = setTimeout(() => reject(new Error("Couldn't reach the matchmaking server.")), CONNECT_TIMEOUT_MS);
			peer.on("open", () => {
				clearTimeout(timer);
				const t = new NetTransport(peer, true, code);
				peer.on("connection", (conn) => t._attach(conn));
				resolve(t);
			});
			peer.on("error", (err) => {
				clearTimeout(timer);
				// Room code collision: extremely unlikely, just try another one.
				if ((err as { type?: string }).type === "unavailable-id") NetTransport.host().then(resolve, reject);
				else reject(err);
			});
		});
	}

	static async join(code: string): Promise<NetTransport> {
		const config = await rtcConfig();
		return new Promise((resolve, reject) => {
			const peer = new Peer({ config });
			const fail = (msg: string) => {
				clearTimeout(timer);
				peer.destroy();
				reject(new Error(msg));
			};
			const timer = setTimeout(
				() =>
					fail(
						hasRelay()
							? "Couldn't connect to that room. Check the code, or try again."
							: "Found the room but couldn't connect to the host. One of your networks is blocking direct connections (common on campus Wi-Fi and hotspots); the relay server fixes this."
					),
				CONNECT_TIMEOUT_MS
			);
			peer.on("error", (err) => {
				const type = (err as { type?: string }).type;
				fail(type === "peer-unavailable" ? "No room with that code." : String(err));
			});
			peer.on("open", () => {
				const conn = peer.connect(ID_PREFIX + code.trim().toUpperCase(), { reliable: true });
				conn.on("open", () => {
					clearTimeout(timer);
					const t = new NetTransport(peer, false, code.trim().toUpperCase());
					t._attach(conn);
					resolve(t);
				});
			});
		});
	}

	private _attach(conn: DataConnection) {
		this._conns.set(conn.peer, conn);
		conn.on("data", (data) => {
			const msg = data as NetMsg & { _b?: 1 };
			// Host relays broadcasts from one guest to the others.
			if (this.isHost && msg._b) {
				for (const [id, c] of this._conns) if (id !== conn.peer && c.open) c.send(msg);
			}
			this.onMessage(msg, conn.peer);
		});
		const gone = () => {
			if (!this._conns.has(conn.peer)) return;
			this._conns.delete(conn.peer);
			if (this.isHost) this.onPeerLeave(conn.peer);
			else this._shutdown("The host left the room.");
		};
		conn.on("close", gone);
		conn.on("error", gone);
	}

	/** Host: to every guest. Guest: to the host, which relays it to everyone else. */
	broadcast(msg: NetMsg) {
		const out = { ...msg, _b: 1 };
		for (const c of this._conns.values()) if (c.open) c.send(out);
	}

	/** Guest: to the host only. Host: to one guest. */
	send(msg: NetMsg, to?: string) {
		if (this.isHost) {
			const c = to ? this._conns.get(to) : undefined;
			if (c?.open) c.send(msg);
		} else {
			for (const c of this._conns.values()) if (c.open) c.send(msg);
		}
	}

	get peerIds() {
		return [...this._conns.keys()];
	}

	private _shutdown(reason: string) {
		if (this._closed) return;
		this._closed = true;
		for (const c of this._conns.values()) c.close();
		this._conns.clear();
		this._peer.destroy();
		this.onClose(reason);
	}

	close() {
		this._shutdown("Left the room.");
	}
}

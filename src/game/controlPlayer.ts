//
// controlPlayer.ts
//--------------------
// Local player kart controls backed by the unified keyboard/gamepad Input.
//

import { Kart } from "../entities/kart";
import { Input } from "./input";

export class controlPlayer implements Controls {
	local: boolean;
	kart!: Kart;

	constructor() {
		this.local = true;
	}

	setKart(k: Kart) {
		this.kart = k;
	}

	fetchInput(): InputData {
		return {
			accel: Input.held("accel"),
			decel: Input.held("brake"),
			drift: Input.held("drift"),
			item: Input.held("item"),
			turn: Input.steer(),
			airTurn: Input.aim(),
		};
	}
}

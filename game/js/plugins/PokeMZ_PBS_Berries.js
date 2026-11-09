//=============================================================================
// PokéMZ - PBS_Berries.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Berry planting (Gen 4 style): soil events, growth
 * stages, watering, mulch and harvests.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_PBS_Pokemon
 * @orderAfter PokeMZ_PBS_Followers
 *
 * @param clock
 * @text Clock
 * @desc "real" uses the computer's clock (like the games); "playtime"
 * only counts time spent playing.
 * @type select
 * @option real
 * @option playtime
 * @default real
 *
 * @param maxReplants
 * @text Regrowths
 * @desc How many times ripe Berries that weren't picked fall and grow
 * again before the plant withers (Gooey Mulch adds half again).
 * @type number
 * @min 0
 * @default 9
 *
 * @help
 * ============================================================================
 * PokeMZ_PBS_Berries
 * ============================================================================
 * Put <Berry Plant> in an event's note (or a comment on its page) to make
 * it soft soil. Talking to it plants, waters and harvests Berries. Growth
 * data comes from berry_plants.json (hours per stage, soil drying, yield).
 *
 * Stages: planted -> sprouted -> taller -> flowering -> Berries. The soil
 * dries over time; a key item flagged "wateringcan" (Sprayduck, Wailmer
 * Pail, Squirt Bottle) waters it. The fewer hours spent dry, the more
 * Berries. Mulch (items with effect "mulch") is laid before planting:
 * params {growth, drying, stay, regrow} multiply the growth time, drying
 * speed, how long ripe Berries stay and the number of regrowths.
 *
 * Graphics: img/characters/berrytree_<berryId>.png (or berrytree.png), an
 * MZ single-character sheet whose rows (down, left, right, up) show the
 * sprouted, taller, flowering and ripe plant. Without a sheet the event
 * keeps its own image.
 */

(() => {
    "use strict";

    //=========================================================================
    // Engine (pure)
    //=========================================================================

    const HOUR = 3600 * 1000;
    const STAGES = ["planted", "sprouted", "taller", "flowering", "berries"];

    /**
     * @brief Mulch factors.
     * @param {Object|null} mulch Item params of the mulch.
     * @return {{growth, drying, stay, regrow}} Multipliers.
     */
    const mulchOf = mulch => Object.assign({ growth: 1, drying: 1, stay: 1, regrow: 1 }, mulch || {});

    /**
     * @brief Advances a plant's moisture and dry time to a time.
     * @param {Object} st Plant state (changed): {moisture, updatedAt,
     *        dryHours}.
     * @param {Object} data berry_plants entry {dryingPerHour}.
     * @param {number} now Time (ms).
     * @param {Object} [mulch] Mulch params.
     */
    function advanceMoisture(st, data, now, mulch) {
        const m = mulchOf(mulch);
        const hours = Math.max(0, (now - st.updatedAt) / HOUR);
        const rate = (data.dryingPerHour || 15) * m.drying;
        const wetHours = rate > 0 ? st.moisture / rate : Infinity;
        if (hours > wetHours) {
            st.dryHours += hours - wetHours;
            st.moisture = 0;
        } else {
            st.moisture = Math.max(0, st.moisture - rate * hours);
        }
        st.updatedAt = now;
    }

    /**
     * @brief Works out what a plant looks like now. Ripe Berries that are
     *        left too long fall and the plant grows again (up to the
     *        regrowth limit).
     * @param {Object} st Plant state {berry, plantedAt, moisture, updatedAt,
     *        dryHours, replants, mulch}. Changed when the plant regrows.
     * @param {Object} data berry_plants entry.
     * @param {number} now Time (ms).
     * @param {Object} [o] {maxReplants, mulch (params)}.
     * @return {{stage: number, name: string, ripe: boolean, withered:
     *         boolean, yield: number, moisture: number, hoursLeft: number}}
     *         The plant now.
     */
    function plantState(st, data, now, o = {}) {
        const m = mulchOf(o.mulch);
        const hps = Math.max(0.1, (data.hoursPerStage || 3) * m.growth);
        const ripeAfter = hps * 4;
        const stay = hps * 4 * m.stay;
        const maxReplants = Math.round((o.maxReplants !== undefined ? o.maxReplants : 9) * m.regrow);
        // Soil drying only matters until the Berries are ripe.
        const ripeAt = st.plantedAt + ripeAfter * HOUR;
        if (now > ripeAt) {
            if (st.updatedAt < ripeAt) {
                advanceMoisture(st, data, ripeAt, o.mulch);
            }
            const dry = st.dryHours;
            advanceMoisture(st, data, now, o.mulch);
            st.dryHours = dry;
        } else {
            advanceMoisture(st, data, now, o.mulch);
        }
        // Regrow after ripe Berries fell.
        let age = (now - st.plantedAt) / HOUR;
        while (age >= ripeAfter + stay) {
            if (st.replants >= maxReplants) {
                return { stage: -1, name: "withered", ripe: false, withered: true, yield: 0, moisture: st.moisture, hoursLeft: 0 };
            }
            st.plantedAt += (ripeAfter + stay) * HOUR;
            st.replants++;
            st.dryHours = 0;
            delete st.lockedYield;
            age = (now - st.plantedAt) / HOUR;
        }
        const stage = Math.min(4, Math.floor(age / hps));
        const [min, max] = data.yield || [2, 5];
        const dryRatio = Math.min(1, st.dryHours / Math.max(1, Math.min(age, ripeAfter)));
        let yieldNow = Math.max(min, Math.round(max - (max - min) * dryRatio));
        if (stage === 4) {
            // Dry time after ripening doesn't count.
            if (st.lockedYield === undefined) {
                st.lockedYield = yieldNow;
            }
            yieldNow = st.lockedYield;
        }
        return {
            stage,
            name: STAGES[stage],
            ripe: stage === 4,
            withered: false,
            yield: yieldNow,
            moisture: st.moisture,
            hoursLeft: stage === 4 ? Math.max(0, ripeAfter + stay - age) : Math.max(0, ripeAfter - age),
        };
    }

    /**
     * @brief A new plant state.
     * @param {string} berry Berry item ID.
     * @param {number} now Time (ms).
     * @param {string} [mulch] Mulch item ID.
     * @return {Object} State.
     */
    function newPlant(berry, now, mulch) {
        return { berry, plantedAt: now, updatedAt: now, moisture: 100, dryHours: 0, replants: 0, mulch: mulch || "" };
    }

    const Engine = { HOUR, STAGES, plantState, newPlant, advanceMoisture };

    if (typeof window === "undefined" || typeof PluginManager === "undefined") {
        if (typeof module !== "undefined" && module.exports) {
            module.exports = Engine;
        }
        return;
    }

    //=========================================================================
    // MZ glue
    //=========================================================================

    const PLUGIN_NAME = "PokeMZ_PBS_Berries";
    const params = PluginManager.parameters(PLUGIN_NAME);
    const CONFIG = {
        clock: params.clock === "playtime" ? "playtime" : "real",
        maxReplants: Number(params.maxReplants || 9),
    };
    const PBS = window.PokeMZ.PBS;
    const Pkmn = window.PokeMZ.Pokemon;
    const tr = (k, f, a) => Pkmn.tr(k, f, a);

    /** @return {number} Current time (ms) on the chosen clock. */
    const now = () => (CONFIG.clock === "playtime" ? $gameSystem.playtime() * 1000 : Date.now());

    /** @return {Object} Saved plants: "mapId:eventId" -> state. */
    const plants = () => {
        if (!$gamePokemon.berries) {
            $gamePokemon.berries = {};
        }
        return $gamePokemon.berries;
    };

    const keyOf = ev => `${ev._mapId}:${ev.eventId()}`;

    /** @return {boolean} True for soil events. */
    function isSoil(ev) {
        const data = ev && ev.event && ev.event();
        if (!data) {
            return false;
        }
        if (/<Berry\s*Plant>/i.test(data.note || "")) {
            return true;
        }
        const page = ev.page && ev.page();
        return !!page && page.list.some(c => (c.code === 108 || c.code === 408) && /<Berry\s*Plant>/i.test(c.parameters[0]));
    }

    /**
     * @return {Object|null} The plant on a soil event now
     *         ({state, data, info}), or null for empty soil.
     */
    function plantOn(ev) {
        const st = plants()[keyOf(ev)];
        if (!st || st.mulchOnly) {
            return null;
        }
        const data = PBS.berryPlants.tryGet(st.berry) || { hoursPerStage: 3, dryingPerHour: 15, yield: [2, 5] };
        const mulch = st.mulch && PBS.items.tryGet(st.mulch) ? PBS.items.get(st.mulch).params : null;
        const info = plantState(st, data, now(), { maxReplants: CONFIG.maxReplants, mulch });
        if (info.withered) {
            delete plants()[keyOf(ev)];
            return null;
        }
        return { state: st, data, info };
    }

    //-------------------------------------------------------------------------
    // Event images
    //-------------------------------------------------------------------------

    const sheetCache = new Map();

    /**
     * @brief Whether a character sheet exists (checked once, quietly).
     * @param {string} name img/characters/ name.
     * @return {boolean|null} True / false, or null while checking.
     */
    function sheetExists(name) {
        if (!sheetCache.has(name)) {
            sheetCache.set(name, null);
            const img = new Image();
            img.onload = () => {
                sheetCache.set(name, true);
                $gameMap.requestRefresh();
            };
            img.onerror = () => sheetCache.set(name, false);
            img.src = `img/characters/${encodeURIComponent(name)}.png${Utils.hasEncryptedImages() ? "_" : ""}`;
        }
        return sheetCache.get(name);
    }

    /** @brief Shows a soil event's plant (when a sheet exists). */
    function refreshImage(ev) {
        const plant = plantOn(ev);
        if (!ev._pmzSoilImage) {
            ev._pmzSoilImage = { name: ev._characterName, index: ev._characterIndex, dir: ev._direction };
        }
        const orig = ev._pmzSoilImage;
        if (!plant || plant.info.stage < 1) {
            ev.setImage(orig.name, orig.index);
            ev.setDirection(orig.dir || 2);
            return;
        }
        const own = `$berrytree_${plant.state.berry}`;
        const name = sheetExists(own) ? own : sheetExists("$berrytree") ? "$berrytree" : "";
        if (!name) {
            ev.setImage(orig.name, orig.index);
            return;
        }
        ev.setImage(name, 0);
        ev.setDirectionFix(false);
        ev.setDirection([2, 4, 6, 8][plant.info.stage - 1]);
        ev.setDirectionFix(true);
        ev.setStepAnime(true);
    }

    const _setupPage = Game_Event.prototype.setupPage;
    Game_Event.prototype.setupPage = function() {
        _setupPage.apply(this, arguments);
        this._pmzSoil = isSoil(this);
        if (this._pmzSoil) {
            this._pmzSoilImage = null;
            refreshImage(this);
        }
    };

    const _eventUpdate = Game_Event.prototype.update;
    Game_Event.prototype.update = function() {
        _eventUpdate.apply(this, arguments);
        if (this._pmzSoil && Graphics.frameCount % 60 === 0) {
            refreshImage(this);
        }
    };

    // Talking to soil runs the berry flow instead of the event's commands.
    const _start = Game_Event.prototype.start;
    Game_Event.prototype.start = function() {
        if (this._pmzSoil) {
            Berries.interact(this);
            return;
        }
        _start.apply(this, arguments);
    };

    const _canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        return !Berries.busy && _canMove.apply(this, arguments);
    };

    //-------------------------------------------------------------------------
    // Flows
    //-------------------------------------------------------------------------

    const UI = () => window.PokeMZ.UI;
    const say = text => (UI() && UI().message ? UI().message(text) : Promise.resolve());
    const ask = text => (UI() && UI().confirm ? UI().confirm(text) : Promise.resolve(false));

    /** @return {Promise<string|null>} An item picked from a list. */
    function pickFrom(ids, title) {
        const PUI = window.PokeMZ.PokemonUI;
        const items = ids.map(id => ({ label: `${PBS.items.get(id).name}  ×${$gameParty.bag().count(id)}`, value: id }));
        items.push({ label: tr("UI.Common.Cancel", "Cancel"), value: null });
        return PUI ? PUI.pickCommand(items, title) : Promise.resolve(ids[0] || null);
    }

    /** @return {Array<string>} Bag items with an effect. */
    const bagWith = test => Object.keys($gameParty.bag()._items).filter(id => PBS.items.has(id) && test(PBS.items.get(id)));

    /** @return {string} A watering can the player has ("" = none). */
    const wateringCan = () => bagWith(i => i.hasFlag("wateringcan") || i.effect === "wateringcan")[0] || "";

    /**
     * @brief Waters the plant on a soil event.
     * @return {Promise<boolean>} True if watered.
     */
    async function water(ev, can) {
        const plant = plantOn(ev);
        if (!plant || plant.info.ripe) {
            return false;
        }
        plant.state.moisture = 100;
        plant.state.updatedAt = now();
        await say(tr("Berry.Msg.Watered", "{player} watered the {berry}.", { player: $gameParty.leader() ? $gameParty.leader().name() : "", berry: PBS.items.get(plant.state.berry).name, can: PBS.items.get(can).name }));
        return true;
    }

    const Berries = {
        config: CONFIG,
        busy: false,
        isSoil,
        plantOn,
        water,

        /**
         * @brief Talking to soil: plant, water or harvest.
         * @param {Game_Event} ev Soil event.
         */
        async interact(ev) {
            if (this.busy) {
                return;
            }
            this.busy = true;
            try {
                await this.flow(ev);
            } finally {
                this.busy = false;
                refreshImage(ev);
            }
        },

        async flow(ev) {
            const bag = $gameParty.bag();
            const player = $gameParty.leader() ? $gameParty.leader().name() : "";
            const plant = plantOn(ev);
            if (!plant) {
                await say(tr("Berry.Msg.Soil", "It's soft, loamy soil."));
                const prepared = plants()[keyOf(ev)];
                let mulch = prepared && prepared.mulchOnly ? prepared.mulchOnly : "";
                const mulches = bagWith(i => i.effect === "mulch");
                if (!mulch && mulches.length && (await ask(tr("Berry.Msg.UseMulch", "Want to fertilize the soil with some mulch?")))) {
                    mulch = (await pickFrom(mulches, tr("Berry.Mulch", "Mulch"))) || "";
                    if (mulch) {
                        bag.lose(mulch, 1);
                        await say(tr("Berry.Msg.Mulched", "{player} scattered the {item} on the soft soil.", { player, item: PBS.items.get(mulch).name }));
                    }
                }
                const seeds = bagWith(i => PBS.berryPlants.has(i.id));
                if (!seeds.length) {
                    if (mulch) {
                        plants()[keyOf(ev)] = { mulchOnly: mulch };
                    }
                    return;
                }
                if (!(await ask(tr("Berry.Msg.WantPlant", "Want to plant a Berry?")))) {
                    return;
                }
                const berry = await pickFrom(seeds, tr("Berry.Choose", "Plant which Berry?"));
                if (!berry) {
                    if (mulch) {
                        plants()[keyOf(ev)] = { mulchOnly: mulch };
                    }
                    return;
                }
                bag.lose(berry, 1);
                plants()[keyOf(ev)] = newPlant(berry, now(), mulch);
                await say(tr("Berry.Msg.Planted", "{player} planted one {berry} in the soft soil.", { player, berry: PBS.items.get(berry).name }));
                return;
            }
            const berry = PBS.items.get(plant.state.berry);
            const info = plant.info;
            if (info.ripe) {
                const n = info.yield;
                await say(tr("Berry.Msg.Ripe", "There {n, plural, one {is # {berry}} other {are # {berry}}}!", { n, berry: berry.name }));
                if (await ask(tr("Berry.Msg.WantPick", "Want to pick the {berry}?", { berry: berry.name }))) {
                    bag.gain(berry.id, n);
                    delete plants()[keyOf(ev)];
                    await say(tr("Berry.Msg.Picked", "{player} picked {n, plural, one {the {berry}} other {the # {berry}}}.", { player, n, berry: berry.name }));
                    await say(tr("Berry.Msg.Returned", "The soil returned to its soft and loamy state."));
                }
                return;
            }
            const stageText = {
                planted: tr("Berry.Msg.Stage.planted", "One {berry} was planted here.", { berry: berry.name }),
                sprouted: tr("Berry.Msg.Stage.sprouted", "{berry} has sprouted.", { berry: berry.name }),
                taller: tr("Berry.Msg.Stage.taller", "This {berry} plant is growing taller.", { berry: berry.name }),
                flowering: tr("Berry.Msg.Stage.flowering", "This {berry} plant is in bloom!", { berry: berry.name }),
            }[info.name];
            await say(stageText);
            await say(info.moisture > 50 ? tr("Berry.Msg.Moist", "The soil is moist.") : info.moisture > 0 ? tr("Berry.Msg.Drying", "The soil is drying out.") : tr("Berry.Msg.Dry", "The soil is dry!"));
            const can = wateringCan();
            if (can && (await ask(tr("Berry.Msg.WantWater", "Want to water the {berry} with the {can}?", { berry: berry.name, can: PBS.items.get(can).name })))) {
                await water(ev, can);
            }
        },
    };

    // Watering cans from the bag water the soil in front of the player.
    const facingSoil = () => {
        const d = $gamePlayer.direction();
        const x = $gameMap.roundXWithDirection($gamePlayer.x, d);
        const y = $gameMap.roundYWithDirection($gamePlayer.y, d);
        return $gameMap.eventsXy(x, y).find(e => e._pmzSoil) || null;
    };
    Pkmn.ItemHandlers.register("wateringcan", {
        target: "none",
        canUse: () => {
            const ev = facingSoil();
            const plant = ev && plantOn(ev);
            return !!plant && !plant.info.ripe;
        },
        async use(_, item) {
            const ev = facingSoil();
            if (ev) {
                await water(ev, item.id);
            }
            return "keep";
        },
    });

    window.PokeMZ.Berries = Object.assign(Engine, Berries);
})();

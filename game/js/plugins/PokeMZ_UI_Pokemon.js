//=============================================================================
// PokéMZ - UI_Pokemon.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v0.1.0] Gen 3 style Preact screens: battle, party, summary,
 * bag, Pokédex, PC, evolution, move learning, move reminder, day care.
 * @author MagickaHat
 * @url https://github.com/MagickaHat/pokemz
 * @base PokeMZ_UI_Core
 * @orderAfter PokeMZ_UI_StartMenu
 * @orderAfter PokeMZ_PBS_Battle
 *
 * @help
 * ============================================================================
 * PokeMZ_UI_Pokemon
 * ============================================================================
 * Place below PokeMZ_UI_StartMenu and the PokeMZ_PBS_* plugins. Replaces the
 * start menu's Pokédex, Party and Bag placeholders and adds the battle,
 * PC, move reminder and day care screens. Summary, evolution and move
 * pickers are overlays, so they also work inside a battle.
 *
 * Every text comes from data/locales/ui.csv and battle.csv. Styles are in
 * css/pokemz-ui.css (.pmz-pk-* classes, variables at the top).
 *
 *   PokeMZ.UI.openScreen("party")
 *   PokeMZ.UI.openScreen("pc")
 *   PokeMZ.PokemonUI.pickPokemon({ title, filter }) -> Promise<Game_Pokemon|null>
 *   PokeMZ.PokemonUI.showSummary(list, index)       -> Promise
 */

(() => {
    "use strict";

    const UI = window.PokeMZ && window.PokeMZ.UI;
    const PBS = window.PokeMZ && window.PokeMZ.PBS;
    const Pkmn = window.PokeMZ && window.PokeMZ.Pokemon;
    if (!UI || !PBS || !Pkmn) {
        console.warn("PokeMZ_UI_Pokemon needs PokeMZ_UI_Core, PokeMZ_PBS_Core and PokeMZ_PBS_Pokemon.");
        return;
    }
    const { html, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useCursorList, useFocus, useFrame } = UI;
    const { Panel, Button, BackButton, Icon } = UI.components;
    const tr = (key, fallback, args) => Pkmn.tr(key, fallback, args);
    const L10n = () => window.PokeMZ.L10n;
    const fmt = n => (L10n() ? L10n().formatNumber(n) : String(n));

    //=========================================================================
    // Modals: overlays in the message layer (safe inside battles)
    //=========================================================================

    /**
     * @brief Mounts a component above everything until it calls done().
     * @param {function(Function): Object} build Receives done(result).
     * @return {Promise<*>} The result.
     */
    function modal(build) {
        return new Promise(resolve => {
            let handle = null;
            const done = result => {
                if (handle) {
                    handle.unmount();
                    handle = null;
                }
                resolve(result);
            };
            // Mount on the next frame so the key press that opened the
            // overlay can't also act inside it.
            UI.wait(1).then(() => {
                handle = UI.mount("message", () => html`<div class="pmz-pk-modal">${build(done)}</div>`);
            });
        });
    }

    //=========================================================================
    // Building blocks
    //=========================================================================

    /**
     * @brief A Pokémon image (front, back or icon) on a pixelated canvas.
     * @param {Object} props {pokemon | speciesId, view, scale, shiny,
     *        silhouette, class, frame (icons)}.
     */
    function PokemonImage(props) {
        const { pokemon, view = "front", scale = 2, silhouette, class: cls, style } = props;
        const speciesId = props.speciesId || (pokemon ? pokemon.speciesId : "");
        const opts = pokemon ? window.PokeMZ.Graphics.optsOf(pokemon, view) : { view, shiny: !!props.shiny };
        if (props.egg) {
            opts.egg = true;
        }
        const [bitmap, setBitmap] = useState(null);
        const ref = useRef(null);
        const key = `${speciesId}|${view}|${opts.shiny}|${opts.female}|${opts.egg}`;
        useEffect(() => {
            let alive = true;
            window.PokeMZ.Graphics.load(speciesId, opts).then(b => alive && setBitmap(b));
            return () => (alive = false);
        }, [key]);
        const isIcon = view === "icon";
        const w = bitmap ? bitmap.width : isIcon ? 32 : 96;
        const h = isIcon ? w : bitmap ? bitmap.height : 96;
        const frame = isIcon ? props.frame || 0 : 0;
        useLayoutEffect(() => {
            const canvas = ref.current;
            if (!canvas || !bitmap) {
                return;
            }
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = false;
            const sy = isIcon && bitmap.height > w ? frame * w : 0;
            ctx.drawImage(bitmap.canvas, 0, sy, w, h, 0, 0, w, h);
            if (silhouette) {
                ctx.globalCompositeOperation = "source-in";
                ctx.fillStyle = typeof silhouette === "string" ? silhouette : "#ffffff";
                ctx.fillRect(0, 0, w, h);
                ctx.globalCompositeOperation = "source-over";
            }
        }, [bitmap, frame, silhouette]);
        return html`<canvas
            ref=${ref}
            class=${`pmz-image pmz-pk-image ${cls || ""}`}
            width=${w}
            height=${h}
            role="img"
            aria-label=${pokemon ? pokemon.name() : speciesId ? (PBS.species.tryGet(speciesId) || {}).name || "" : ""}
            style=${Object.assign({ width: `${w * scale}px`, height: `${h * scale}px` }, style || {})}
        />`;
    }

    /** @brief A bobbing party icon. */
    function PokemonIcon({ pokemon, scale = 2, active }) {
        const count = UI.useFrameCount();
        const r = pokemon && pokemon.mhp ? pokemon.hp / pokemon.mhp : 1;
        const speed = pokemon && pokemon.isEgg && pokemon.isEgg() ? 24 : r <= 0 ? 0 : r < 0.25 ? 32 : r < 0.5 ? 20 : 10;
        const frame = speed ? Math.floor(count / (active ? speed / 2 : speed)) % 2 : 0;
        return html`<${PokemonImage} pokemon=${pokemon} view="icon" scale=${scale} frame=${frame} class="pmz-pk-icon" />`;
    }

    /** @brief HP bar (green / yellow / red). */
    function HpBar({ hp, max, numbers }) {
        const r = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
        const color = r > 0.5 ? "is-high" : r > 0.2 ? "is-mid" : "is-low";
        return html`<div class="pmz-pk-hp" role="meter" aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${hp} aria-label=${tr("Pkmn.HP", "HP")}>
            <span class="pmz-pk-hp-label">${tr("Pkmn.HP", "HP")}</span>
            <span class="pmz-pk-hp-track"><span class=${`pmz-pk-hp-fill ${color}`} style=${{ width: `${r * 100}%` }}></span></span>
            ${numbers ? html`<span class="pmz-pk-hp-numbers">${hp}/${max}</span>` : null}
        </div>`;
    }

    /** @brief EXP bar for a Pokémon. */
    function ExpBar({ pokemon }) {
        const lv = pokemon.level;
        const a = pokemon.expForLevel(lv);
        const b = pokemon.expForLevel(lv + 1);
        const r = pokemon.isMaxLevel() ? 0 : Math.max(0, Math.min(1, (pokemon.currentExp() - a) / Math.max(1, b - a)));
        return html`<div class="pmz-pk-exp" aria-hidden="true"><span class="pmz-pk-exp-fill" style=${{ width: `${r * 100}%` }}></span></div>`;
    }

    /** @brief Type badge with the type's color. */
    function TypeBadge({ type }) {
        const t = PBS.types.tryGet(type);
        return html`<span class="pmz-pk-type" style=${{ "--pmz-type": t ? t.color : "#a8a878" }}>${t ? t.name : type}</span>`;
    }

    /** @brief ♂ / ♀ mark. */
    function Gender({ gender }) {
        if (gender === "male") {
            return html`<span class="pmz-pk-gender is-male" aria-label=${tr("Pkmn.Male", "Male")}>♂</span>`;
        }
        if (gender === "female") {
            return html`<span class="pmz-pk-gender is-female" aria-label=${tr("Pkmn.Female", "Female")}>♀</span>`;
        }
        return null;
    }

    /** @brief Status badge (PAR, BRN...). */
    function StatusBadge({ status, fainted }) {
        const s = fainted ? "fnt" : status;
        if (!s) {
            return null;
        }
        return html`<span class=${`pmz-pk-status is-${s}`}>${tr(`Status.Short.${s}`, s.toUpperCase())}</span>`;
    }

    /** @brief "Lv. 5". */
    const Level = ({ level }) => html`<span class="pmz-pk-level">${tr("Pkmn.Lv", "Lv. {level}", { level })}</span>`;

    /** @brief A bottom help line with a Back button. */
    function HelpBar({ text, onBack }) {
        return html`<div class="pmz-panel pmz-pk-help">
            <span>${text}</span>
            ${onBack ? html`<${BackButton} onPress=${onBack} class="pmz-pk-help-back" />` : null}
        </div>`;
    }

    /**
     * @brief A small command list popup.
     * @param {Object} props {items: [{label, value, disabled}], onPick(value),
     *        onCancel(), class}.
     */
    function CommandList({ items, onPick, onCancel, class: cls, title }) {
        const cursor = useCursorList(items.length, {
            onOk: i => onPick(items[i].value),
            onCancel,
            isEnabled: i => !items[i].disabled,
            priority: 5,
        });
        return html`<div class=${`pmz-panel pmz-pk-commands ${cls || ""}`} role="menu" aria-label=${title || ""}>
            ${title ? html`<div class="pmz-pk-commands-title">${title}</div>` : null}
            <div class="pmz-list" ...${cursor.listProps}>
                ${items.map((it, i) => html`<div role="menuitem" key=${i} ...${cursor.itemProps(i)}>${it.label}</div>`)}
            </div>
        </div>`;
    }

    /** @return {Promise<*>} A command picked from a popup (null = cancel). */
    const pickCommand = (items, title) =>
        modal(done => html`<${CommandList} items=${items} title=${title} onPick=${done} onCancel=${() => done(null)} class="is-floating" />`);

    //=========================================================================
    // Party list (screen and picker)
    //=========================================================================

    /** @brief One party slot. */
    function PartySlot({ pokemon, lead, itemProps, badge, disabled }) {
        if (!pokemon) {
            return html`<div class=${`pmz-pk-slot is-empty ${lead ? "is-lead" : ""}`}></div>`;
        }
        const egg = pokemon.isEgg();
        const props = Object.assign({}, itemProps);
        props.class = `${props.class || ""} pmz-pk-slot ${lead ? "is-lead" : ""} ${pokemon.hp <= 0 && !egg ? "is-fainted" : ""} ${disabled ? "is-disabled" : ""}`;
        return html`<div role="option" aria-selected=${String(props.class.includes("is-selected"))} ...${props}>
            <${PokemonIcon} pokemon=${pokemon} active=${props.class.includes("is-selected")} />
            <div class="pmz-pk-slot-body">
                <div class="pmz-pk-slot-name">
                    <span class="pmz-pk-name">${pokemon.name()}</span>
                    ${egg ? null : html`<${Gender} gender=${pokemon.gender} />`}
                </div>
                ${egg
                    ? null
                    : html`<div class="pmz-pk-slot-info">
                          <${Level} level=${pokemon.level} />
                          <${StatusBadge} status=${pokemon.status} fainted=${pokemon.hp <= 0} />
                          ${pokemon.heldItem ? html`<span class="pmz-pk-held" aria-label=${tr("Pkmn.HeldItem", "Held item")}>◆</span>` : null}
                          ${badge ? html`<span class="pmz-pk-badge">${badge}</span>` : null}
                      </div>
                      <${HpBar} hp=${pokemon.hp} max=${pokemon.mhp} numbers=${true} />`}
            </div>
        </div>`;
    }

    /**
     * @brief The party in the Gen 3 layout (lead on the left).
     * @param {Object} props {list, onOk(i), onCancel(), isEnabled(i), help,
     *        marked (index being moved), badge(pkmn)}.
     */
    function PartyView(props) {
        const list = props.list;
        const cursor = useCursorList(list.length, {
            onOk: props.onOk,
            onCancel: props.onCancel,
            isEnabled: props.isEnabled,
            initial: props.initial || 0,
            handlers: {
                left: () => cursor.setIndex(0),
                right: () => cursor.index === 0 && list.length > 1 && cursor.setIndex(1),
            },
            priority: props.priority,
        });
        UI.useGame(() => list.map(p => `${p.hp}|${p.status}|${p.level}|${p.speciesId}`).join(","));
        const rest = [];
        for (let i = 1; i < Pkmn.config.partySize; i++) {
            rest.push(i);
        }
        return html`<div class="pmz-pk-party" role="listbox" aria-label=${tr("Party.Title", "Pokémon")} ...${cursor.listProps}>
            <div class="pmz-pk-party-lead">
                <${PartySlot}
                    pokemon=${list[0]}
                    lead=${true}
                    itemProps=${list[0] ? cursor.itemProps(0, props.marked === 0 ? "is-marked" : "") : null}
                    badge=${list[0] && props.badge ? props.badge(list[0]) : ""}
                    disabled=${props.isEnabled && list[0] ? !props.isEnabled(0) : false}
                />
            </div>
            <div class="pmz-pk-party-rest">
                ${rest.map(
                    i => html`<${PartySlot}
                        key=${i}
                        pokemon=${list[i]}
                        itemProps=${list[i] ? cursor.itemProps(i, props.marked === i ? "is-marked" : "") : null}
                        badge=${list[i] && props.badge ? props.badge(list[i]) : ""}
                        disabled=${props.isEnabled && list[i] ? !props.isEnabled(i) : false}
                    />`
                )}
            </div>
            <${HelpBar} text=${props.help} onBack=${props.onCancel} />
        </div>`;
    }

    /**
     * @brief Lets the player pick a party Pokémon (overlay).
     * @param {Object} [o] {help, filter(pkmn) -> boolean, cancel = true,
     *        list}.
     * @return {Promise<Game_Pokemon|null>} The Pokémon (null = cancelled).
     */
    function pickPokemon(o = {}) {
        const list = o.list || $gameParty.pokemon();
        return modal(done => html`<div class="pmz-pk-screen">
            <${PartyView}
                list=${list}
                help=${o.help || tr("Party.Choose", "Choose a Pokémon.")}
                isEnabled=${i => !o.filter || o.filter(list[i])}
                badge=${o.badge}
                onOk=${i => done(list[i])}
                onCancel=${o.cancel === false ? undefined : () => done(null)}
                priority=${5}
            />
        </div>`);
    }

    /** @brief The party screen (start menu). */
    function PartyScreen({ close }) {
        UI.useStrings();
        const [version, setVersion] = useState(0);
        const [moving, setMoving] = useState(-1);
        const [busy, setBusy] = useState(false);
        const list = $gameParty.pokemon();
        const refresh = () => setVersion(v => v + 1);
        const run = async fn => {
            setBusy(true);
            try {
                await fn();
            } finally {
                setBusy(false);
                refresh();
            }
        };
        const onOk = i => {
            if (moving >= 0) {
                $gameParty.swapPokemon(moving, i);
                setMoving(-1);
                refresh();
                return;
            }
            const p = list[i];
            run(async () => {
                const items = [{ label: tr("Party.Cmd.Summary", "Summary"), value: "summary" }];
                if (!p.isEgg() && p.canEvolve()) {
                    items.push({ label: tr("Party.Cmd.Evolve", "Evolve"), value: "evolve" });
                }
                for (const move of p.isEgg() ? [] : Pkmn.FieldMoves.usable(p)) {
                    items.push({ label: PBS.moves.get(move).name, value: `field:${move}` });
                }
                items.push({ label: tr("Party.Cmd.Switch", "Switch"), value: "switch", disabled: list.length < 2 });
                if (!p.isEgg()) {
                    items.push({ label: tr("Party.Cmd.Item", "Item"), value: "item" });
                }
                items.push({ label: tr("UI.Common.Cancel", "Cancel"), value: null });
                const cmd = await pickCommand(items, p.name());
                if (cmd === "summary") {
                    await showSummary(list, i);
                } else if (cmd === "evolve") {
                    await Pkmn.Flow.evolveReady(p);
                } else if (cmd === "switch") {
                    setMoving(i);
                } else if (cmd === "item") {
                    await itemMenu(p);
                } else if (cmd && cmd.startsWith("field:")) {
                    const h = Pkmn.FieldMoves.get(cmd.slice(6));
                    close();
                    await h.use(p);
                }
            });
        };
        return html`<div class="pmz-pk-screen pmz-pk-party-screen" data-version=${version}>
            <${PartyView}
                list=${list}
                marked=${moving}
                help=${moving >= 0 ? tr("Party.MoveTo", "Move to where?") : tr("Party.Choose", "Choose a Pokémon.")}
                badge=${p => (!p.isEgg() && p.canEvolve() ? tr("Party.CanEvolve", "Evolve!") : "")}
                onOk=${onOk}
                onCancel=${() => (moving >= 0 ? setMoving(-1) : close())}
                priority=${busy ? -1 : 0}
            />
        </div>`;
    }

    /** @brief Give / take a held item. */
    async function itemMenu(p) {
        const cmd = await pickCommand(
            [
                { label: tr("Party.Cmd.Give", "Give"), value: "give" },
                { label: tr("Party.Cmd.Take", "Take"), value: "take", disabled: !p.heldItem },
                { label: tr("UI.Common.Cancel", "Cancel"), value: null },
            ],
            p.name()
        );
        if (cmd === "give") {
            const id = await pickItem({ mode: "give" });
            if (!id) {
                return;
            }
            if (p.heldItem) {
                $gameParty.bag().gain(p.heldItem, 1);
            }
            $gameParty.bag().lose(id, 1);
            p.heldItem = id;
            await UI.message(tr("Party.Msg.Gave", "{name} was given the {item} to hold.", { name: p.name(), item: PBS.items.get(id).name }));
        } else if (cmd === "take") {
            const item = PBS.items.get(p.heldItem);
            $gameParty.bag().gain(p.heldItem, 1);
            p.heldItem = "";
            await UI.message(tr("Party.Msg.Took", "Received the {item} from {name}.", { name: p.name(), item: item.name }));
        }
    }

    //=========================================================================
    // Summary (overlay)
    //=========================================================================

    const STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"];
    const statName = s => tr(`Stat.${s}`, { hp: "HP", atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" }[s]);

    /** @brief A move row (name, type, PP). */
    function MoveRow({ id, pp, maxPp }) {
        const m = PBS.moves.tryGet(id);
        if (!m) {
            return html`<span>-</span>`;
        }
        return html`<span class="pmz-pk-move">
            <${TypeBadge} type=${m.type} />
            <span class="pmz-pk-move-name">${m.name}</span>
            ${pp !== undefined ? html`<span class="pmz-pk-move-pp">${tr("Pkmn.PP", "PP")} ${pp}/${maxPp}</span>` : null}
        </span>`;
    }

    /** @brief Move details (power, accuracy, description). */
    function MoveDetails({ id }) {
        const m = PBS.moves.tryGet(id);
        if (!m) {
            return null;
        }
        return html`<div class="pmz-pk-move-details">
            <div class="pmz-pk-kv"><span>${tr("Move.Category", "Category")}</span><span>${tr(`Move.Category.${m.category}`, m.category)}</span></div>
            <div class="pmz-pk-kv"><span>${tr("Move.Power", "Power")}</span><span>${m.power || "—"}</span></div>
            <div class="pmz-pk-kv"><span>${tr("Move.Accuracy", "Accuracy")}</span><span>${m.accuracy || "—"}</span></div>
            <p class="pmz-pk-desc">${m.description}</p>
        </div>`;
    }

    /** @brief The summary view. */
    function SummaryView({ list, index: start, done, reorder }) {
        UI.useStrings();
        const [index, setIndex] = useState(start || 0);
        const [page, setPage] = useState(0);
        const [moveIndex, setMoveIndex] = useState(-1);
        const [swap, setSwap] = useState(-1);
        const [, force] = useState(0);
        const p = list[index];
        const pages = p.isEgg() ? 1 : 3;
        const moves = p.moves();
        useFocus(
            {
                left: () => moveIndex < 0 && page > 0 && (SoundManager.playCursor(), setPage(page - 1)),
                right: () => moveIndex < 0 && page < pages - 1 && (SoundManager.playCursor(), setPage(page + 1)),
                up: () => {
                    if (moveIndex >= 0) {
                        setMoveIndex((moveIndex + moves.length - 1) % moves.length);
                    } else if (list.length > 1) {
                        setIndex((index + list.length - 1) % list.length);
                        setPage(Math.min(page, list[(index + list.length - 1) % list.length].isEgg() ? 0 : 2));
                    }
                    SoundManager.playCursor();
                },
                down: () => {
                    if (moveIndex >= 0) {
                        setMoveIndex((moveIndex + 1) % moves.length);
                    } else if (list.length > 1) {
                        setIndex((index + 1) % list.length);
                        setPage(Math.min(page, list[(index + 1) % list.length].isEgg() ? 0 : 2));
                    }
                    SoundManager.playCursor();
                },
                ok: () => {
                    if (page === 2 && moveIndex < 0) {
                        SoundManager.playOk();
                        setMoveIndex(0);
                    } else if (page === 2 && reorder !== false) {
                        SoundManager.playOk();
                        if (swap < 0) {
                            setSwap(moveIndex);
                        } else {
                            p.swapMoves(swap, moveIndex);
                            setSwap(-1);
                            force(x => x + 1);
                        }
                    }
                },
                cancel: () => {
                    SoundManager.playCancel();
                    if (swap >= 0) {
                        setSwap(-1);
                    } else if (moveIndex >= 0) {
                        setMoveIndex(-1);
                    } else {
                        done();
                    }
                },
            },
            { priority: 6 }
        );
        const species = p.species();
        const tabs = [tr("Summary.Info", "Info"), tr("Summary.Skills", "Skills"), tr("Summary.Moves", "Moves")].slice(0, pages);
        const nature = PBS.natures.tryGet(p.nature);
        const mint = p.statNature() !== p.nature ? PBS.natures.tryGet(p.statNature()) : null;
        const statNature = PBS.natures.tryGet(p.statNature());
        let body;
        if (p.isEgg()) {
            const steps = p._eggSteps;
            const stage = steps > 10 * 257 ? "Far" : steps > 5 * 257 ? "Mid" : "Soon";
            body = html`<div class="pmz-pk-summary-page">
                <p>${tr(`Summary.Egg.${stage}`, { Far: "It looks like this Egg will take a long time to hatch.", Mid: "What will hatch from this? It doesn't seem close to hatching.", Soon: "Sounds can be heard coming from inside! It will hatch soon!" }[stage])}</p>
            </div>`;
        } else if (page === 0) {
            body = html`<div class="pmz-pk-summary-page">
                <div class="pmz-pk-kv"><span>${tr("Summary.DexNo", "Dex No.")}</span><span>${String(species.num).padStart(4, "0")}</span></div>
                <div class="pmz-pk-kv"><span>${tr("Summary.Species", "Species")}</span><span>${species.name}</span></div>
                <div class="pmz-pk-kv"><span>${tr("Summary.Type", "Type")}</span><span>${p.types().map(t => html`<${TypeBadge} key=${t} type=${t} />`)}</span></div>
                <div class="pmz-pk-kv"><span>${tr("Summary.OT", "OT")}</span><span>${p._otName || "—"}</span></div>
                <div class="pmz-pk-kv"><span>${tr("Summary.ID", "ID No.")}</span><span>${String(p._otId >= 0 ? p._otId : 0).padStart(5, "0")}</span></div>
                <div class="pmz-pk-kv"><span>${tr("Summary.Item", "Item")}</span><span>${p.heldItem ? PBS.items.get(p.heldItem).name : tr("Summary.None", "None")}</span></div>
                <p class="pmz-pk-memo">
                    ${tr("Summary.Memo", "{nature} nature. Met at Lv. {level}.", { nature: nature ? nature.name : "", level: p._metLevel || p.level })}
                    ${mint ? html`<br />${tr("Summary.Mint", "Stats changed by the {nature} Mint.", { nature: mint.name })}` : null}
                </p>
            </div>`;
        } else if (page === 1) {
            const next = p.isMaxLevel() ? 0 : p.expForLevel(p.level + 1) - p.currentExp();
            const ability = PBS.abilities.tryGet(p.ability());
            body = html`<div class="pmz-pk-summary-page">
                <div class="pmz-pk-kv"><span>${statName("hp")}</span><span>${p.hp}/${p.mhp}</span></div>
                <${HpBar} hp=${p.hp} max=${p.mhp} />
                ${STAT_ORDER.slice(1).map(s => {
                    const mod = statNature ? statNature.modifier(s) : 1;
                    return html`<div class="pmz-pk-kv" key=${s}>
                        <span class=${mod > 1 ? "is-up" : mod < 1 ? "is-down" : ""}>${statName(s)}${mod > 1 ? " ▲" : mod < 1 ? " ▼" : ""}</span>
                        <span>${p.stat(s)}</span>
                    </div>`;
                })}
                <div class="pmz-pk-kv"><span>${tr("Summary.Exp", "Exp. Points")}</span><span>${fmt(p.currentExp())}</span></div>
                <div class="pmz-pk-kv"><span>${tr("Summary.NextLv", "To Next Lv.")}</span><span>${fmt(next)}</span></div>
                <${ExpBar} pokemon=${p} />
                <div class="pmz-pk-ability"><b>${ability ? ability.name : ""}</b> ${ability ? ability.description : ""}</div>
            </div>`;
        } else {
            body = html`<div class="pmz-pk-summary-page pmz-pk-summary-moves">
                <div class="pmz-list" role="listbox">
                    ${moves.map(
                        (m, i) => html`<div key=${m.id} role="option" class=${`pmz-item ${i === moveIndex ? "is-selected is-focused" : ""} ${i === swap ? "is-marked" : ""}`}>
                            <${MoveRow} id=${m.id} pp=${m.pp} maxPp=${p.maxPp(i)} />
                        </div>`
                    )}
                </div>
                ${moveIndex >= 0 ? html`<${MoveDetails} id=${moves[moveIndex] && moves[moveIndex].id} />` : null}
            </div>`;
        }
        return html`<div class="pmz-pk-screen pmz-pk-summary">
            <div class="pmz-panel pmz-pk-summary-head">
                <div class="pmz-pk-tabs" role="tablist">
                    ${tabs.map((t, i) => html`<span key=${i} role="tab" aria-selected=${String(i === page)} class=${i === page ? "is-active" : ""} onPointerUp=${() => setPage(i)}>${t}</span>`)}
                </div>
            </div>
            <div class="pmz-panel pmz-pk-summary-card">
                <${PokemonImage} pokemon=${p} view="front" scale=${2} />
                <div class="pmz-pk-summary-name">
                    <span class="pmz-pk-name">${p.name()}</span>
                    ${p.isEgg() ? null : html`<${Gender} gender=${p.gender} />`}
                </div>
                ${p.isEgg() ? null : html`<div><${Level} level=${p.level} /> ${p.shiny ? html`<span class="pmz-pk-shiny" aria-label=${tr("Pkmn.Shiny", "Shiny")}>★</span>` : null}</div>`}
                ${p.isEgg() ? null : html`<${StatusBadge} status=${p.status} fainted=${p.hp <= 0} />`}
            </div>
            <div class="pmz-panel pmz-pk-summary-body">${body}</div>
            <${HelpBar} text=${page === 2 ? tr("Summary.MovesHelp", "OK: details / reorder") : tr("Summary.Help", "←→ Page  ↑↓ Pokémon")} onBack=${() => done()} />
        </div>`;
    }

    /** @return {Promise} Shows the summary overlay. */
    const showSummary = (list, index, o = {}) => modal(done => html`<${SummaryView} list=${list} index=${index} done=${done} reorder=${o.reorder} />`);

    //=========================================================================
    // Move pickers (overlays)
    //=========================================================================

    /**
     * @brief Picks one of a Pokémon's moves (and optionally a new one).
     * @param {Game_Pokemon} p Pokémon.
     * @param {Object} o {title, extra (new move ID), filter(i)}.
     * @return {Promise<number>} Slot (4 = the new move, -1 = cancel).
     */
    function pickMove(p, o = {}) {
        const ids = p.moves().map(m => m.id);
        if (o.extra) {
            ids.push(o.extra);
        }
        return modal(done => {
            function MovePicker() {
                const [sel, setSel] = useState(0);
                const cursor = useCursorList(ids.length, {
                    onOk: i => done(i),
                    onCancel: () => done(-1),
                    onChange: setSel,
                    isEnabled: i => !o.filter || o.filter(i),
                    priority: 6,
                });
                return html`<div class="pmz-pk-screen pmz-pk-movepick">
                    <div class="pmz-panel pmz-pk-movepick-head">
                        <${PokemonIcon} pokemon=${p} />
                        <span>${o.title || p.name()}</span>
                    </div>
                    <div class="pmz-panel pmz-pk-movepick-list">
                        <div class="pmz-list" role="listbox" ...${cursor.listProps}>
                            ${ids.map(
                                (id, i) => html`<div key=${i} role="option" ...${cursor.itemProps(i, i === 4 ? "is-new" : "")}>
                                    <${MoveRow} id=${id} pp=${i < 4 ? p.moves()[i].pp : PBS.moves.get(id).pp} maxPp=${i < 4 ? p.maxPp(i) : PBS.moves.get(id).pp} />
                                </div>`
                            )}
                        </div>
                    </div>
                    <div class="pmz-panel pmz-pk-movepick-details"><${MoveDetails} id=${ids[sel]} /></div>
                    <${HelpBar} text=${o.help || ""} onBack=${() => done(-1)} />
                </div>`;
            }
            return html`<${MovePicker} />`;
        });
    }

    Pkmn.Flow.chooseMoveToForget = (p, newMove) =>
        pickMove(p, {
            extra: newMove,
            title: tr("Move.ForgetTitle", "Forget which move?"),
            help: tr("Move.ForgetHelp", "Choose a move to forget, or the new move to give it up."),
        }).then(i => (i >= 0 && i < 4 ? i : -1));

    Pkmn.Flow.chooseMove = (p, prompt) => pickMove(p, { title: prompt });

    //=========================================================================
    // Evolution (overlay)
    //=========================================================================

    /** @brief The evolution sequence; B cancels. */
    function EvolutionView({ pokemon, target, done }) {
        UI.useStrings();
        const [phase, setPhase] = useState("intro");
        const [frame, setFrame] = useState(0);
        const name = pokemon.name();
        useEffect(() => {
            UI.message(tr("Evolution.Start", "What? {name} is evolving!", { name })).then(() => setPhase("morph"));
        }, []);
        useFrame(() => {
            if (phase === "morph") {
                setFrame(f => {
                    if (f >= 300) {
                        setPhase("done");
                        SoundManager.playRecovery();
                        setTimeout(() => done(true), 600);
                    }
                    return f + 1;
                });
            }
        });
        useFocus(
            {
                cancel: () => {
                    if (phase === "morph") {
                        SoundManager.playCancel();
                        setPhase("stopped");
                        done(false);
                    }
                },
            },
            { priority: 4 }
        );
        // Alternate the two silhouettes faster and faster.
        const period = Math.max(4, 40 - Math.floor(frame / 8));
        const showNew = phase === "done" || (phase === "morph" && Math.floor(frame / period) % 2 === 1);
        const silhouette = phase === "morph" ? "#ffffff" : null;
        return html`<div class="pmz-pk-screen pmz-pk-evolution">
            <div class="pmz-pk-evolution-stage">
                ${showNew
                    ? html`<${PokemonImage} speciesId=${target} shiny=${pokemon.shiny} view="front" scale=${3} silhouette=${silhouette} />`
                    : html`<${PokemonImage} pokemon=${pokemon} view="front" scale=${3} silhouette=${silhouette} />`}
            </div>
            <div class="pmz-pk-help pmz-panel"><span>${phase === "morph" ? tr("Evolution.CancelHelp", "Press Cancel to stop the evolution.") : ""}</span></div>
        </div>`;
    }

    Pkmn.Flow.evolutionScene = (pokemon, target) => modal(done => html`<${EvolutionView} pokemon=${pokemon} target=${target} done=${done} />`);

    Pkmn.Flow.chooseEvolution = (pokemon, options) =>
        pickCommand(
            options.map(id => ({ label: PBS.species.get(id).name, value: id })).concat([{ label: tr("UI.Common.Cancel", "Cancel"), value: null }]),
            tr("Evolution.Choose", "Evolve {name} into which Pokémon?", { name: pokemon.name() })
        );

    //=========================================================================
    // Bag
    //=========================================================================

    /**
     * @brief The bag view.
     * @param {Object} props {pockets, onPick(id), onCancel(), help}.
     */
    function BagView({ pockets, onPick, onCancel, priority, help }) {
        UI.useStrings();
        const bag = $gameParty.bag();
        const [pocketIndex, setPocketIndex] = useState(() => {
            const last = pockets.indexOf(bag._lastPocket);
            return last >= 0 ? last : Math.max(0, pockets.findIndex(p => bag.pocketItems(p).length > 0));
        });
        const pocket = pockets[pocketIndex];
        UI.useGame(() => JSON.stringify(bag._items));
        const entries = bag.pocketItems(pocket);
        const [sel, setSel] = useState(0);
        const changePocket = d => {
            const i = (pocketIndex + d + pockets.length) % pockets.length;
            setPocketIndex(i);
            bag._lastPocket = pockets[i];
            setSel(0);
            SoundManager.playCursor();
        };
        const cursor = useCursorList(entries.length + 1, {
            onOk: i => (i < entries.length ? onPick(entries[i].item.id) : onCancel()),
            onCancel,
            onChange: setSel,
            handlers: { left: () => changePocket(-1), right: () => changePocket(1), pageup: () => changePocket(-1), pagedown: () => changePocket(1) },
            priority,
        });
        const current = entries[sel];
        return html`<div class="pmz-pk-bag">
            <div class="pmz-panel pmz-pk-bag-pocket">
                <span class="pmz-pk-arrow" role="button" aria-label=${tr("Bag.PrevPocket", "Previous pocket")} onPointerUp=${() => changePocket(-1)}>◀</span>
                <span class="pmz-pk-bag-pocket-name">${tr(`Bag.Pocket.${pocket}`, pocket)}</span>
                <span class="pmz-pk-arrow" role="button" aria-label=${tr("Bag.NextPocket", "Next pocket")} onPointerUp=${() => changePocket(1)}>▶</span>
                <div class="pmz-pk-dots" aria-hidden="true">${pockets.map((p, i) => html`<span key=${p} class=${i === pocketIndex ? "is-active" : ""}></span>`)}</div>
            </div>
            <div class="pmz-panel pmz-pk-bag-list">
                <div class="pmz-list" role="listbox" aria-label=${tr(`Bag.Pocket.${pocket}`, pocket)} ...${cursor.listProps}>
                    ${entries.map(
                        (e, i) => html`<div key=${e.item.id} role="option" ...${cursor.itemProps(i)}>
                            <span class="pmz-pk-bag-name">${e.item.name}</span>
                            ${e.item.isKeyItem ? (bag.registered().includes(e.item.id) ? html`<span class="pmz-pk-badge">${tr("Bag.Registered", "SEL")}</span>` : null) : html`<span class="pmz-pk-bag-count">×${e.count}</span>`}
                        </div>`
                    )}
                    <div key="close" role="option" ...${cursor.itemProps(entries.length)}>${tr("Bag.Close", "Close Bag")}</div>
                </div>
            </div>
            <div class="pmz-panel pmz-pk-bag-desc">
                ${current ? html`<${Icon} index=${current.item.iconIndex} scale=${1.5} />` : null}
                <p>${current ? current.item.description : help || ""}</p>
            </div>
        </div>`;
    }

    /**
     * @brief Picks an item from the bag (overlay).
     * @param {Object} o {pockets, mode ("give" | "battle" | "use")}.
     * @return {Promise<string|null>} Item ID.
     */
    function pickItem(o = {}) {
        const all = $gameParty.bag().pockets();
        const pockets = o.pockets || (o.mode === "give" ? all.filter(p => p !== "key") : all);
        return modal(done => html`<div class="pmz-pk-screen"><${BagView} pockets=${pockets} onPick=${done} onCancel=${() => done(null)} priority=${5} /></div>`);
    }

    /** @brief Uses a bag item from the field (asks for a Pokémon if needed). */
    async function useFromBag(id, close) {
        const item = PBS.items.get(id);
        const h = Pkmn.ItemHandlers.of(item);
        if (!h || h.target === "battle") {
            await UI.message(tr("Bag.Msg.CantUse", "There's a time and place for everything! But not now."));
            return;
        }
        if (h.target === "none") {
            if (item.fieldUse === "direct" && ["repel", "escaperope", "rod", "bicycle"].includes(item.effect)) {
                if (!h.canUse(null, item)) {
                    await UI.message(tr("Bag.Msg.CantUse", "There's a time and place for everything! But not now."));
                    return;
                }
                if (item.effect !== "repel") {
                    close();
                }
            }
            await Pkmn.useItem(id, null);
            return;
        }
        const p = await pickPokemon({
            help: tr("Bag.UseOn", "Use on which Pokémon?"),
            badge: x => (x.isEgg() ? "" : h.canUse(x, item, item.params || {}) ? tr("Bag.Able", "ABLE") : tr("Bag.NotAble", "NOT ABLE")),
        });
        if (p) {
            await Pkmn.useItem(id, p);
        }
    }

    /** @brief The bag screen (start menu). */
    function BagScreen({ close }) {
        const [busy, setBusy] = useState(false);
        const onPick = id => {
            setBusy(true);
            (async () => {
                const item = PBS.items.get(id);
                const bag = $gameParty.bag();
                const h = Pkmn.ItemHandlers.of(item);
                const items = [];
                if (h && h.target !== "battle") {
                    items.push({ label: tr("Bag.Cmd.Use", "Use"), value: "use" });
                }
                if (item.isKeyItem) {
                    items.push({ label: bag.registered().includes(id) ? tr("Bag.Cmd.Deselect", "Deselect") : tr("Bag.Cmd.Register", "Register"), value: "register" });
                } else {
                    items.push({ label: tr("Bag.Cmd.Give", "Give"), value: "give" });
                    items.push({ label: tr("Bag.Cmd.Toss", "Toss"), value: "toss" });
                }
                items.push({ label: tr("UI.Common.Cancel", "Cancel"), value: null });
                const cmd = await pickCommand(items, item.name);
                if (cmd === "use") {
                    await useFromBag(id, close);
                } else if (cmd === "register") {
                    bag.toggleRegistered(id);
                } else if (cmd === "give") {
                    const p = await pickPokemon({ help: tr("Bag.GiveTo", "Give to which Pokémon?"), filter: x => !x.isEgg() });
                    if (p) {
                        if (p.heldItem) {
                            bag.gain(p.heldItem, 1);
                        }
                        bag.lose(id, 1);
                        p.heldItem = id;
                        await UI.message(tr("Party.Msg.Gave", "{name} was given the {item} to hold.", { name: p.name(), item: item.name }));
                    }
                } else if (cmd === "toss") {
                    const n = await UI.inputNumber(String(bag.count(id)).length, 1, { text: tr("Bag.TossHowMany", "Toss how many {item}?", { item: item.name }) });
                    const k = Math.min(n, bag.count(id));
                    if (k > 0 && (await UI.confirm(tr("Bag.TossConfirm", "Throw away {n} × {item}?", { n: k, item: item.name })))) {
                        bag.lose(id, k);
                        await UI.message(tr("Bag.Tossed", "Threw away {n} × {item}.", { n: k, item: item.name }));
                    }
                }
            })().finally(() => setBusy(false));
        };
        return html`<div class="pmz-pk-screen">
            <${BagView} pockets=${$gameParty.bag().pockets()} onPick=${onPick} onCancel=${close} priority=${busy ? -1 : 0} />
        </div>`;
    }

    //=========================================================================
    // Pokédex
    //=========================================================================

    /** @brief Pokédex entry (locked unless caught). */
    function DexEntry({ id, done }) {
        UI.useStrings();
        const s = PBS.species.get(id);
        const dex = $gamePokemon.pokedex;
        const open = dex.canViewEntry(id);
        useFocus({ ok: () => done(), cancel: () => (SoundManager.playCancel(), done()) }, { priority: 6 });
        const unknown = tr("Dex.Unknown", "?????");
        const metric = (v, unit) => tr(`Dex.Unit.${unit}`, unit === "m" ? "{n} m" : "{n} kg", { n: L10n() ? L10n().formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : v.toFixed(1) });
        return html`<div class="pmz-pk-screen pmz-pk-dex-entry">
            <div class="pmz-panel pmz-pk-dex-card">
                <${PokemonImage} speciesId=${id} view="front" scale=${2} silhouette=${dex.isSeen(id) ? null : "#404040"} />
                <div>
                    <div class="pmz-pk-name">${String(s.num).padStart(4, "0")} ${dex.isSeen(id) ? s.name : unknown}</div>
                    <div>${open ? tr("Dex.Genus", "{genus}", { genus: s.genus }) : unknown}</div>
                    <div>${open ? s.types.map(t => html`<${TypeBadge} key=${t} type=${t} />`) : unknown}</div>
                    <div class="pmz-pk-kv"><span>${tr("Dex.Height", "Height")}</span><span>${open ? metric(s.height / 10, "m") : unknown}</span></div>
                    <div class="pmz-pk-kv"><span>${tr("Dex.Weight", "Weight")}</span><span>${open ? metric(s.weight / 10, "kg") : unknown}</span></div>
                </div>
            </div>
            <div class="pmz-panel pmz-pk-dex-text">
                <p>${open ? s.dexEntry : tr("Dex.Locked", "Catch this Pokémon to complete its entry.")}</p>
            </div>
            <${HelpBar} text="" onBack=${() => done()} />
        </div>`;
    }

    /** @brief The Pokédex list. */
    function PokedexScreen({ close }) {
        UI.useStrings();
        const dex = $gamePokemon.pokedex;
        const dexes = [""].concat(PBS.regionalDexes.ids());
        const [which, setWhich] = useState(dexes.length > 1 ? 1 : 0);
        const [busy, setBusy] = useState(false);
        const list = useMemo(() => dex.list(dexes[which]), [which]);
        // Show up to the last seen species, like the games.
        const lastSeen = list.reduce((n, id, i) => (dex.isSeen(id) ? i : n), -1);
        const shown = list.slice(0, Math.max(lastSeen + 1, Math.min(list.length, 10)));
        const cursor = useCursorList(shown.length, {
            onOk: i => {
                if (!dex.isSeen(shown[i])) {
                    SoundManager.playBuzzer();
                    return;
                }
                setBusy(true);
                modal(done => html`<${DexEntry} id=${shown[i]} done=${done} />`).then(() => setBusy(false));
            },
            onCancel: close,
            handlers: { shift: () => dexes.length > 1 && (SoundManager.playCursor(), setWhich((which + 1) % dexes.length)) },
            pageRows: 8,
            priority: busy ? -1 : 0,
        });
        const dexName = dexes[which] ? PBS.regionalDexes.get(dexes[which]).name : tr("Dex.National", "National Dex");
        return html`<div class="pmz-pk-screen pmz-pk-dex">
            <div class="pmz-panel pmz-pk-dex-head">
                <span>${dexName}</span>
                <span>${tr("Dex.Seen", "Seen {n}", { n: dex.seenCount(list) })}</span>
                <span>${tr("Dex.Caught", "Owned {n}", { n: dex.caughtCount(list) })}</span>
            </div>
            <div class="pmz-panel pmz-pk-dex-list">
                <div class="pmz-list" role="listbox" ...${cursor.listProps}>
                    ${shown.map(id => {
                        const s = PBS.species.get(id);
                        const i = shown.indexOf(id);
                        return html`<div key=${id} role="option" ...${cursor.itemProps(i)}>
                            <span class="pmz-pk-dex-num">${String(i + 1).padStart(3, "0")}</span>
                            <span class=${`pmz-pk-dex-mark ${dex.isCaught(id) ? "is-caught" : ""}`} aria-label=${dex.isCaught(id) ? tr("Dex.CaughtMark", "Caught") : ""}></span>
                            <span>${dex.isSeen(id) ? s.name : "----------"}</span>
                        </div>`;
                    })}
                </div>
            </div>
            <div class="pmz-panel pmz-pk-dex-preview">
                ${shown[cursor.index] && dex.isSeen(shown[cursor.index]) ? html`<${PokemonImage} speciesId=${shown[cursor.index]} view="front" scale=${2} />` : null}
            </div>
            <${HelpBar} text=${dexes.length > 1 ? tr("Dex.Help", "Shift: switch Pokédex") : ""} onBack=${close} />
        </div>`;
    }

    //=========================================================================
    // PC
    //=========================================================================

    /** @brief The PC: box grid and party column. */
    function PcScreen({ close }) {
        UI.useStrings();
        const st = $gamePokemon.storage;
        const size = st.boxSize();
        const cols = 6;
        const [box, setBox] = useState(st.current);
        const [cur, setCur] = useState(0); // 0..size-1 grid, size.. party
        const [held, setHeld] = useState(null); // {pokemon, from}
        const [busy, setBusy] = useState(false);
        const [, force] = useState(0);
        const party = $gameParty.pokemon();
        const partySlots = Pkmn.config.partySize;
        const total = size + partySlots;
        const rows = Math.ceil(size / cols);
        const at = i => (i < size ? st.get(box, i) : party[i - size] || null);
        const changeBox = d => {
            const b = (box + d + st.boxCount()) % st.boxCount();
            setBox(b);
            st.current = b;
            SoundManager.playCursor();
        };
        const ableOthers = p => $gameParty.ablePokemon().filter(x => x !== p).length > 0;
        const putAt = (i, p) => {
            if (i < size) {
                return st.put(box, i, p);
            }
            const j = i - size;
            const old = party[j] || null;
            if (p) {
                if (j < party.length) {
                    $gameParty.setPokemonAt(j, p);
                } else {
                    $gameParty._pokemonParty.push(p.actorId());
                    $gameActors.addPokemon(p);
                }
            } else if (old) {
                $gameParty.removePokemon(old);
            }
            return old;
        };
        const act = async () => {
            const p = at(cur);
            if (held) {
                const target = at(cur);
                if (cur >= size && !held.pokemon.isAble() && !$gameParty.ablePokemon().length) {
                    SoundManager.playBuzzer();
                    return;
                }
                putAt(cur, held.pokemon);
                setHeld(target ? { pokemon: target, from: cur } : null);
                SoundManager.playOk();
                force(x => x + 1);
                return;
            }
            if (!p) {
                SoundManager.playBuzzer();
                return;
            }
            setBusy(true);
            try {
                const inParty = cur >= size;
                const cmd = await pickCommand(
                    [
                        { label: tr("PC.Cmd.Move", "Move"), value: "move", disabled: inParty && !ableOthers(p) && p.isAble() },
                        { label: tr("PC.Cmd.Summary", "Summary"), value: "summary" },
                        inParty
                            ? { label: tr("PC.Cmd.Deposit", "Deposit"), value: "deposit", disabled: !ableOthers(p) && p.isAble() }
                            : { label: tr("PC.Cmd.Withdraw", "Withdraw"), value: "withdraw", disabled: party.length >= partySlots },
                        { label: tr("PC.Cmd.Release", "Release"), value: "release", disabled: inParty && !ableOthers(p) && p.isAble() },
                        { label: tr("UI.Common.Cancel", "Cancel"), value: null },
                    ],
                    p.name()
                );
                if (cmd === "move") {
                    putAt(cur, null);
                    setHeld({ pokemon: p, from: cur });
                } else if (cmd === "summary") {
                    await showSummary([p], 0);
                } else if (cmd === "withdraw") {
                    st.take(box, cur);
                    $gameParty._pokemonParty.push(p.actorId());
                } else if (cmd === "deposit") {
                    if (st.isFull()) {
                        await UI.message(tr("PC.Msg.Full", "The boxes are full."));
                    } else {
                        $gameParty.removePokemon(p);
                        const where = st.deposit(p);
                        await UI.message(tr("PC.Msg.SentToBox", "{name} was sent to {box}.", { name: p.name(), box: st.boxName(where.box) }));
                    }
                } else if (cmd === "release") {
                    if (await UI.confirm(tr("PC.Msg.ReleaseConfirm", "Release {name}?", { name: p.name() }))) {
                        if (inParty) {
                            $gameParty.removePokemon(p);
                            $gameActors.deletePokemon(p.actorId());
                        } else {
                            st.release(box, cur);
                        }
                        await UI.message(tr("PC.Msg.Released", "{name} was released. Bye-bye, {name}!", { name: p.name() }));
                    }
                }
            } finally {
                setBusy(false);
                force(x => x + 1);
            }
        };
        const move = (dx, dy) => {
            SoundManager.playCursor();
            if (cur < size) {
                const x = cur % cols;
                const y = Math.floor(cur / cols);
                if (dx > 0 && x === cols - 1) {
                    setCur(size + Math.min(partySlots - 1, y));
                } else if (dx < 0 && x === 0) {
                    setCur(size + Math.min(partySlots - 1, y));
                } else if (dx) {
                    setCur(cur + dx);
                } else {
                    setCur(((y + dy + rows) % rows) * cols + x);
                }
            } else {
                const j = cur - size;
                if (dx) {
                    setCur(Math.min(rows - 1, j) * cols + (dx > 0 ? 0 : cols - 1));
                } else {
                    setCur(size + ((j + dy + partySlots) % partySlots));
                }
            }
        };
        useFocus(
            {
                left: () => move(-1, 0),
                right: () => move(1, 0),
                up: () => move(0, -1),
                down: () => move(0, 1),
                pageup: () => changeBox(-1),
                pagedown: () => changeBox(1),
                ok: () => act(),
                cancel: () => {
                    if (held) {
                        // Put the held Pokémon back where it came from.
                        if (!at(held.from)) {
                            putAt(held.from, held.pokemon);
                            setHeld(null);
                        } else if (!st.deposit(held.pokemon)) {
                            SoundManager.playBuzzer();
                            return;
                        } else {
                            setHeld(null);
                        }
                        SoundManager.playCancel();
                        return;
                    }
                    SoundManager.playCancel();
                    close();
                },
            },
            { priority: busy ? -1 : 0 }
        );
        const cell = i => {
            const p = at(i);
            return html`<div
                key=${i}
                role="gridcell"
                aria-selected=${String(i === cur)}
                aria-label=${p ? p.name() : tr("PC.Empty", "Empty")}
                class=${`pmz-pk-pc-cell ${i === cur ? "is-selected" : ""}`}
                onPointerUp=${() => (i === cur ? act() : setCur(i))}
            >
                ${p ? html`<${PokemonIcon} pokemon=${p} scale=${1.5} active=${i === cur} />` : null}
                ${i === cur && held ? html`<div class="pmz-pk-pc-held"><${PokemonIcon} pokemon=${held.pokemon} scale=${1.5} active=${true} /></div>` : null}
            </div>`;
        };
        const focus = at(cur) || (held && held.pokemon);
        return html`<div class="pmz-pk-screen pmz-pk-pc">
            <div class="pmz-panel pmz-pk-pc-info">
                ${focus ? html`<${PokemonImage} pokemon=${focus} view="front" scale=${1.5} />` : null}
                ${focus ? html`<div class="pmz-pk-name">${focus.name()}</div>` : null}
                ${focus && !focus.isEgg() ? html`<div><${Level} level=${focus.level} /> <${Gender} gender=${focus.gender} /></div>` : null}
                ${focus && !focus.isEgg() ? html`<div class="pmz-pk-pc-types">${focus.types().map(t => html`<${TypeBadge} key=${t} type=${t} />`)}</div>` : null}
            </div>
            <div class=${`pmz-panel pmz-pk-pc-box is-wallpaper-${st.wallpaper(box)}`}>
                <div class="pmz-pk-pc-boxname">
                    <span class="pmz-pk-arrow" role="button" onPointerUp=${() => changeBox(-1)} aria-label=${tr("PC.PrevBox", "Previous box")}>◀</span>
                    <span>${st.boxName(box)}</span>
                    <span class="pmz-pk-arrow" role="button" onPointerUp=${() => changeBox(1)} aria-label=${tr("PC.NextBox", "Next box")}>▶</span>
                </div>
                <div class="pmz-pk-pc-grid" role="grid" style=${{ "--pmz-cols": cols }}>${Array.from({ length: size }, (_, i) => cell(i))}</div>
            </div>
            <div class="pmz-panel pmz-pk-pc-party" role="grid" aria-label=${tr("Party.Title", "Pokémon")}>
                ${Array.from({ length: partySlots }, (_, j) => cell(size + j))}
            </div>
            <${HelpBar} text=${held ? tr("PC.HelpHeld", "Place it where?") : tr("PC.Help", "PgUp/PgDn: box  OK: options")} onBack=${close} />
        </div>`;
    }

    //=========================================================================
    // Move reminder and day care
    //=========================================================================

    /** @brief Move reminder: pick a Pokémon, then a move from its bank. */
    function MoveReminderScreen({ close }) {
        useEffect(() => {
            (async () => {
                for (;;) {
                    const p = await pickPokemon({
                        help: tr("Reminder.Choose", "Which Pokémon should remember a move?"),
                        filter: x => !x.isEgg() && x.rememberableMoves().length > 0,
                    });
                    if (!p) {
                        break;
                    }
                    const ids = p.rememberableMoves();
                    const pick = await modal(done => {
                        function List() {
                            const [sel, setSel] = useState(0);
                            const cursor = useCursorList(ids.length, { onOk: i => done(ids[i]), onCancel: () => done(null), onChange: setSel, priority: 6, pageRows: 7 });
                            return html`<div class="pmz-pk-screen pmz-pk-movepick">
                                <div class="pmz-panel pmz-pk-movepick-head"><${PokemonIcon} pokemon=${p} /><span>${tr("Reminder.Title", "Remember which move?")}</span></div>
                                <div class="pmz-panel pmz-pk-movepick-list">
                                    <div class="pmz-list" role="listbox" ...${cursor.listProps}>
                                        ${ids.map((id, i) => html`<div key=${id} role="option" ...${cursor.itemProps(i)}><${MoveRow} id=${id} /></div>`)}
                                    </div>
                                </div>
                                <div class="pmz-panel pmz-pk-movepick-details"><${MoveDetails} id=${ids[sel]} /></div>
                                <${HelpBar} text="" onBack=${() => done(null)} />
                            </div>`;
                        }
                        return html`<${List} />`;
                    });
                    if (pick) {
                        await Pkmn.Flow.teachMove(p, pick);
                    }
                }
                close();
            })();
        }, []);
        return html`<div class="pmz-pk-screen"></div>`;
    }

    /** @brief Day care counter. */
    function DayCareScreen({ close }) {
        useEffect(() => {
            (async () => {
                const dc = $gamePokemon.dayCare;
                if (dc.hasEgg()) {
                    if ($gameParty.pokemon().length >= Pkmn.config.partySize) {
                        await UI.message(tr("DayCare.Msg.NoRoomEgg", "We found an Egg, but you have no room for it."));
                    } else if (await UI.confirm(tr("DayCare.Msg.EggFound", "We found an Egg! Do you want it?"))) {
                        const egg = dc.collectEgg();
                        if (egg) {
                            $gameParty.addPokemon(egg);
                            await UI.message(tr("DayCare.Msg.GotEgg", "You received the Egg from the Day Care!"));
                        }
                    }
                }
                for (;;) {
                    const [a, b] = dc.pokemon();
                    const items = [
                        { label: tr("DayCare.Cmd.Deposit", "Leave a Pokémon"), value: "deposit", disabled: dc.count() >= 2 },
                        { label: tr("DayCare.Cmd.Withdraw", "Take back a Pokémon"), value: "withdraw", disabled: dc.count() === 0 },
                        { label: tr("DayCare.Cmd.Check", "Check on them"), value: "check", disabled: dc.count() < 2 },
                        { label: tr("UI.Common.Cancel", "Cancel"), value: null },
                    ];
                    const cmd = await pickCommand(items, tr("DayCare.Title", "Day Care"));
                    if (!cmd) {
                        break;
                    }
                    if (cmd === "deposit") {
                        const p = await pickPokemon({
                            help: tr("DayCare.Choose", "Which Pokémon should we raise?"),
                            filter: x => !x.isEgg() && $gameParty.ablePokemon().filter(y => y !== x).length > 0,
                        });
                        if (p) {
                            $gameParty.removePokemon(p);
                            dc.deposit(p);
                            await UI.message(tr("DayCare.Msg.Deposited", "We'll raise your {name} for a while.", { name: p.name() }));
                        }
                    } else if (cmd === "withdraw") {
                        const list = [a, b].filter(Boolean);
                        const pick = await pickCommand(
                            list.map(p => ({ label: `${p.name()}  ${tr("Pkmn.Lv", "Lv. {level}", { level: p.level })}`, value: p })).concat([{ label: tr("UI.Common.Cancel", "Cancel"), value: null }]),
                            tr("DayCare.Cmd.Withdraw", "Take back a Pokémon")
                        );
                        if (pick && $gameParty.pokemon().length < Pkmn.config.partySize) {
                            dc.withdraw(dc.pokemon().indexOf(pick));
                            $gameParty.addPokemon(pick);
                            await UI.message(tr("DayCare.Msg.Withdrew", "You took back {name}.", { name: pick.name() }));
                        } else if (pick) {
                            await UI.message(tr("DayCare.Msg.PartyFull", "Your party is full."));
                        }
                    } else if (cmd === "check") {
                        const c = dc.compatibility();
                        const key = c >= 70 ? "High" : c >= 50 ? "Mid" : c > 0 ? "Low" : "None";
                        await UI.message(
                            tr(`DayCare.Compat.${key}`, {
                                High: "The two seem to get along very well!",
                                Mid: "The two seem to get along.",
                                Low: "The two don't seem to like each other much.",
                                None: "The two prefer to play with other Pokémon than each other.",
                            }[key])
                        );
                    }
                }
                close();
            })();
        }, []);
        return html`<div class="pmz-pk-screen"></div>`;
    }

    //=========================================================================
    // Battle screen (FRLG inspired; singles, doubles and multi)
    //=========================================================================

    const Engine = () => window.PokeMZ.Battle || {};

    /**
     * @brief Screen position of a battler: "foe0", "foe1", "player0",
     *        "player1". In multi battles the partner (p3) and the second foe
     *        (p4) take the second positions.
     * @param {string} side Side ID.
     * @param {number} slot Active slot.
     * @return {string} Position key.
     */
    function viewKey(side, slot) {
        if (side === "p3") {
            return "player1";
        }
        if (side === "p4") {
            return "foe1";
        }
        return `${side === "p1" ? "player" : "foe"}${Math.max(0, slot)}`;
    }

    /** @brief A battler's HP box. */
    function BattleBox({ pos, info, compact }) {
        if (!info || info.hidden) {
            return null;
        }
        const mine = pos.startsWith("player") && info.side === "p1";
        return html`<div class=${`pmz-panel pmz-pk-bbox is-${pos} ${compact ? "is-compact" : ""}`} aria-live="polite">
            <div class="pmz-pk-bbox-top">
                <span class="pmz-pk-name">${info.name}</span>
                <${Gender} gender=${info.gender} />
                <${Level} level=${info.level} />
                ${info.tera ? html`<${TypeBadge} type=${info.tera} />` : null}
            </div>
            <div class="pmz-pk-bbox-hp">
                <${StatusBadge} status=${info.status} />
                <${HpBar} hp=${info.hp} max=${info.maxhp} numbers=${mine && !compact} />
            </div>
            ${mine && info.pokemon && !compact ? html`<${ExpBar} pokemon=${info.pokemon} />` : null}
        </div>`;
    }

    /** @brief One battler sprite (with form, Dynamax and Tera looks). */
    function Battler({ pos, info }) {
        if (!info || info.hidden) {
            return null;
        }
        const back = pos.startsWith("player");
        const cls = `pmz-pk-battler is-${pos} anim-${info.anim || ""} ${info.dmax ? "is-dynamax" : ""} ${info.tera ? "is-tera" : ""}`;
        const form = info.formId && info.pokemon && info.formId !== info.pokemon.speciesId;
        return html`<div class=${cls} key=${`${pos}-${info.token}`}>
            ${form
                ? html`<${PokemonImage} speciesId=${info.formId} shiny=${info.pokemon.shiny} view=${back ? "back" : "front"} scale=${2} />`
                : html`<${PokemonImage} pokemon=${info.pokemon} view=${back ? "back" : "front"} scale=${2} />`}
        </div>`;
    }

    /**
     * @brief Picks a move target (doubles): foes on top, allies below.
     * @param {Array<{loc, pokemon, side}>} targets Choices from the bridge.
     * @param {BattleBridge} bridge Bridge.
     * @return {Promise<number|null>} Target location (null = cancel).
     */
    function pickTarget(targets, bridge) {
        const foes = targets.filter(t => t.loc > 0).sort((a, b) => b.loc - a.loc);
        const allies = targets.filter(t => t.loc < 0).sort((a, b) => a.loc - b.loc);
        const list = foes.concat(allies);
        return modal(done => {
            function TargetPicker() {
                const cursor = useCursorList(list.length, { columns: 2, onOk: i => done(list[i].loc), onCancel: () => done(null), priority: 6 });
                return html`<div class="pmz-pk-target">
                    <div class="pmz-panel pmz-pk-target-panel" role="listbox" aria-label=${tr("Battle.ChooseTarget", "Choose a target.")}>
                        <div class="pmz-pk-target-title">${tr("Battle.ChooseTarget", "Choose a target.")}</div>
                        <div class="pmz-list" style=${{ "--pmz-columns": 2 }} ...${cursor.listProps}>
                            ${list.map((t, i) => {
                                const p = bridge.member(t.side, t.pokemon.name);
                                return html`<div key=${t.loc} role="option" ...${cursor.itemProps(i, t.loc > 0 ? "is-foe" : "is-ally")}>${p ? p.name() : t.pokemon.name}</div>`;
                            })}
                        </div>
                    </div>
                </div>`;
            }
            return html`<${TargetPicker} />`;
        });
    }

    /** @brief The battle screen. Gets {bridge} from PokeMZ.Battle. */
    function BattleScreen({ bridge, close }) {
        UI.useStrings();
        const [field, setField] = useState({});
        const [message, setMessage] = useState(null); // {text, done}
        const [menu, setMenu] = useState(null); // {kind, slot, ctx, resolve}
        const [ball, setBall] = useState(null); // {shakes, caught, key, pos}
        const msgFrames = useRef(0);
        const fieldRef = useRef({});

        const wait = frames => UI.wait(frames);
        /** @brief Finds the position of a token (events without a slot). */
        const posOf = (side, slot, token) => {
            if (slot >= 0 || side === "p3" || side === "p4") {
                return viewKey(side, slot);
            }
            const found = Object.keys(fieldRef.current).find(k => fieldRef.current[k] && fieldRef.current[k].side === side && fieldRef.current[k].token === token);
            return found || viewKey(side, 0);
        };
        const simOf = (side, token) => bridge.battle[side].pokemon.find(x => x.name === token);
        const infoFor = (side, token) => {
            const p = bridge.member(side, token);
            const sp = simOf(side, token);
            return {
                side,
                token,
                pokemon: p,
                formId: sp ? sp.species.id : p ? p.speciesId : "",
                name: p ? p.name() : token,
                level: sp ? sp.level : p ? p.level : 1,
                gender: p ? p.gender : "",
                hp: sp ? sp.hp : 0,
                maxhp: sp ? sp.maxhp : 1,
                status: sp && sp.status !== "fnt" ? sp.status : "",
                anim: "enter",
            };
        };
        const update = (pos, patch) => {
            const next = Object.assign({}, fieldRef.current[pos], patch);
            fieldRef.current = Object.assign({}, fieldRef.current, { [pos]: next });
            setField(fieldRef.current);
        };
        const refreshHp = (pos, side, token) => {
            const sp = simOf(side, token);
            if (sp) {
                update(pos, { hp: sp.hp, maxhp: sp.maxhp, level: sp.level });
            }
        };

        const presenter = useMemo(
            () => ({
                tr: (k, f, a) => tr(k, f, a),
                say(text) {
                    if (!text) {
                        return Promise.resolve();
                    }
                    return new Promise(resolve => {
                        msgFrames.current = 0;
                        setMessage({ text, done: resolve });
                    });
                },
                async show(ev) {
                    const pos = ev.side ? posOf(ev.side, ev.slot, ev.token) : "";
                    switch (ev.type) {
                        case "switch":
                            update(pos, infoFor(ev.side, ev.token));
                            if (ev.side === "p1") {
                                SoundManager.playOk();
                            }
                            break;
                        case "damage":
                        case "heal":
                        case "sethp":
                            refreshHp(pos, ev.side, ev.token);
                            update(pos, { anim: ev.type === "damage" && !ev.from ? "hit" : "" });
                            if (ev.type === "damage" && !ev.from) {
                                SoundManager.playEnemyDamage();
                                if (ev.side === "p1" && window.PokeMZ.Input) {
                                    window.PokeMZ.Input.rumble(0.7, 0.4, 12);
                                }
                            }
                            await wait(24);
                            break;
                        case "faint":
                            update(pos, { anim: "faint", hp: 0 });
                            SoundManager.playEnemyCollapse();
                            if (ev.side === "p1" && window.PokeMZ.Input) {
                                window.PokeMZ.Input.rumble(0.9, 0.9, 24);
                            }
                            await wait(30);
                            break;
                        case "status":
                            update(pos, { status: ev.status });
                            break;
                        case "curestatus":
                            update(pos, { status: "" });
                            break;
                        case "detailschange":
                        case "formechange":
                            update(pos, { formId: ev.species, anim: "" });
                            refreshHp(pos, ev.side, ev.token);
                            SoundManager.playRecovery();
                            await wait(20);
                            break;
                        case "terastallize":
                            update(pos, { tera: ev.teraType });
                            SoundManager.playRecovery();
                            break;
                        case "start":
                        case "end":
                            if (ev.effect === "dynamax") {
                                update(pos, { dmax: ev.type === "start" });
                                refreshHp(pos, ev.side, ev.token);
                                await wait(20);
                            }
                            break;
                        default:
                            break;
                    }
                    const text = bridge.formatText(ev);
                    if (text) {
                        await this.say(text);
                    }
                    if (ev.type === "faint") {
                        update(pos, { hidden: true });
                    }
                },
                chooseAction(b, slot = 0, ctx = {}) {
                    return new Promise(resolve => setMenu({ kind: "command", slot, ctx, resolve }));
                },
                async chooseSwitch(b, forced, o = {}) {
                    const taken = o.taken || new Set();
                    for (;;) {
                        const p = await pickPokemon({
                            list: $gameParty.pokemon(),
                            help: forced ? tr("Battle.ChooseNext", "Choose a Pokémon to send out.") : tr("Party.Choose", "Choose a Pokémon."),
                            filter: x => {
                                const sp = b.simOf(x);
                                return x.isAble() && !!sp && !sp.fainted && !sp.isActive && !taken.has(b.battle.p1.pokemon.indexOf(sp));
                            },
                            cancel: !forced,
                        });
                        if (p || !forced) {
                            return p;
                        }
                    }
                },
                chooseMoveSlot: (p, prompt) => pickMove(p, { title: prompt }),
                refresh(b) {
                    b.battle.p1.active.forEach((sp, slot) => sp && refreshHp(viewKey("p1", slot), "p1", sp.name));
                },
                async ballShakes(shakes, caught) {
                    const target = bridge.foesOf("p1")[0];
                    const pos = target ? posOf(target.side.id, target.position, target.name) : "foe0";
                    setBall({ shakes, caught, key: Date.now(), pos });
                    await wait(30 + shakes * 36 + 20);
                    if (caught) {
                        update(pos, { hidden: true });
                    } else {
                        setBall(null);
                    }
                },
            }),
            []
        );

        useEffect(() => {
            bridge.presenter = presenter;
            bridge
                .run()
                .then(async result => {
                    await bridge.finish(result);
                    bridge.result = result;
                    close();
                })
                .catch(e => {
                    console.error(e);
                    bridge.result = bridge.result || "lose";
                    close();
                });
            return () => {
                if (bridge.onClosed) {
                    bridge.onClosed(bridge.result || "run");
                }
            };
        }, []);

        // Messages move on by themselves after a while (OK skips).
        useFrame(() => {
            if (message && ++msgFrames.current >= bridge.messageFrames) {
                const done = message.done;
                setMessage(null);
                done();
            }
        });
        useFocus(
            {
                ok: () => {
                    if (message && msgFrames.current > 8) {
                        const done = message.done;
                        setMessage(null);
                        done();
                    }
                },
            },
            { enabled: !!message, priority: 1 }
        );

        const doubles = bridge.format !== "singles";
        const positions = doubles ? ["foe1", "foe0", "player1", "player0"] : ["foe0", "player0"];
        const resolve = a => {
            const m = menu;
            setMenu(null);
            m.resolve(a);
        };
        return html`<div class=${`pmz-pk-battle ${doubles ? "is-doubles" : "is-singles"}`} role="application" aria-label=${tr("Battle.Title", "Battle")}>
            <div class="pmz-pk-battle-field">
                <div class="pmz-pk-platform is-foe"></div>
                <div class="pmz-pk-platform is-player"></div>
                ${positions.map(pos => html`<${Battler} key=${pos} pos=${pos} info=${field[pos]} />`)}
                ${ball ? html`<div key=${ball.key} class=${`pmz-pk-ball at-${ball.pos} shakes-${ball.shakes} ${ball.caught ? "is-caught" : ""}`} aria-hidden="true"></div>` : null}
                ${positions.map(pos => html`<${BattleBox} key=${`b-${pos}`} pos=${pos} info=${field[pos]} compact=${doubles} />`)}
            </div>
            <div class="pmz-pk-battle-bottom">
                ${menu && !message
                    ? menu.kind === "moves"
                        ? html`<${MoveMenu} bridge=${bridge} menu=${menu} back=${() => setMenu(Object.assign({}, menu, { kind: "command" }))} pick=${resolve} />`
                        : html`<${CommandMenu} bridge=${bridge} menu=${menu} setMenu=${setMenu} pick=${resolve} />`
                    : html`<div class="pmz-panel pmz-pk-battle-msg" aria-live="assertive"><span>${message ? message.text : ""}</span></div>`}
            </div>
        </div>`;
    }

    /** @brief FIGHT / BAG / POKéMON / RUN for one active slot. */
    function CommandMenu({ bridge, menu, setMenu, pick }) {
        const slot = menu.slot || 0;
        const active = bridge.active("p1", slot);
        const p = active ? bridge.member("p1", active.name) : null;
        const items = [
            { label: tr("Battle.Cmd.Fight", "FIGHT"), value: "fight" },
            { label: tr("Battle.Cmd.Bag", "BAG"), value: "bag" },
            { label: tr("Battle.Cmd.Pokemon", "POKéMON"), value: "pokemon" },
            { label: tr("Battle.Cmd.Run", "RUN"), value: "run" },
        ];
        const [busy, setBusy] = useState(false);
        const choose = async value => {
            if (value === "fight") {
                setMenu(Object.assign({}, menu, { kind: "moves" }));
                return;
            }
            if (value === "run") {
                pick({ type: "run" });
                return;
            }
            setBusy(true);
            try {
                if (value === "bag") {
                    const id = await pickItem({ pockets: ["medicine", "balls", "battle", "berries"].filter(x => $gameParty.bag().pockets().includes(x)) });
                    if (!id) {
                        return;
                    }
                    const item = PBS.items.get(id);
                    if (item.battleUse === "none" && item.effect !== "ball") {
                        await UI.message(tr("Bag.Msg.CantUse", "There's a time and place for everything! But not now."));
                        return;
                    }
                    let target = null;
                    if (item.battleUse === "onpokemon" || item.battleUse === "onmove") {
                        const h = Pkmn.ItemHandlers.of(item);
                        target = await pickPokemon({
                            help: tr("Bag.UseOn", "Use on which Pokémon?"),
                            filter: x => !x.isEgg() && (!h || !h.canUse || h.canUse(x, item, item.params || {})),
                        });
                        if (!target) {
                            return;
                        }
                    }
                    pick({ type: "item", item: id, target });
                } else if (value === "pokemon") {
                    const pk = await bridge.presenter.chooseSwitch(bridge, false, { slot, taken: menu.ctx && menu.ctx.taken });
                    if (pk) {
                        pick({ type: "switch", pokemon: pk });
                    }
                }
            } finally {
                setBusy(false);
            }
        };
        const cursor = useCursorList(items.length, {
            columns: 2,
            onOk: i => choose(items[i].value),
            onCancel: slot > 0 ? () => pick({ type: "back" }) : undefined,
            priority: busy ? -1 : 2,
        });
        return html`<div class="pmz-pk-battle-cmd">
            <div class="pmz-panel pmz-pk-battle-msg"><span>${tr("Battle.WhatWillDo", "What will {pokemon} do?", { pokemon: p ? p.name() : "" })}</span></div>
            <div class="pmz-panel pmz-pk-battle-commands">
                <div class="pmz-list" role="menu" style=${{ "--pmz-columns": 2 }} ...${cursor.listProps}>
                    ${items.map((it, i) => html`<div key=${it.value} role="menuitem" ...${cursor.itemProps(i)}>${it.label}</div>`)}
                </div>
            </div>
        </div>`;
    }

    /** @brief Key item each gimmick needs. */
    const GIMMICK_ITEMS = { mega: "megaring", zmove: "zring", dynamax: "dynamaxband", terastallize: "teraorb" };

    /**
     * @return {Array<string>} Gimmicks the player may use for a slot now.
     */
    function gimmicksFor(slotReq, ctx) {
        if (ctx && ctx.gimmickUsed) {
            return [];
        }
        const bag = $gameParty.bag();
        const out = [];
        const has = g => bag.count(GIMMICK_ITEMS[g]) > 0;
        if (slotReq.canMegaEvo && has("mega")) {
            out.push("mega");
        }
        if (slotReq.canZMove && has("zmove")) {
            out.push("zmove");
        }
        if (slotReq.canDynamax && has("dynamax")) {
            out.push("dynamax");
        }
        if (slotReq.canTerastallize && has("terastallize") && $gamePokemon.teraCharged !== false) {
            out.push("terastallize");
        }
        return out;
    }

    /** @brief The move menu with the PP / TYPE panel and gimmick toggle. */
    function MoveMenu({ bridge, menu, back, pick }) {
        const slot = menu.slot || 0;
        const req = bridge.battle.p1.activeRequest;
        const slotReq = (req && req.active && req.active[slot]) || { moves: [] };
        const moves = slotReq.moves.filter(m => m.id !== Engine().ACTION_MOVE);
        const gimmicks = gimmicksFor(slotReq, menu.ctx);
        const [gimmick, setGimmick] = useState("");
        const [sel, setSel] = useState(0);
        const [busy, setBusy] = useState(false);
        const labelOf = (m, i) => {
            if (gimmick === "zmove" && slotReq.canZMove) {
                const z = slotReq.canZMove[i];
                return z ? z.move : m.move;
            }
            if (gimmick === "dynamax" && slotReq.maxMoves) {
                const mx = slotReq.maxMoves.maxMoves[i];
                return mx ? (PBS.moves.tryGet(mx.move) || { name: mx.move }).name : m.move;
            }
            return (PBS.moves.tryGet(m.id) || { name: m.move }).name;
        };
        const targetOf = i => {
            if (gimmick === "zmove" && slotReq.canZMove && slotReq.canZMove[i]) {
                return slotReq.canZMove[i].target;
            }
            if (gimmick === "dynamax" && slotReq.maxMoves && slotReq.maxMoves.maxMoves[i]) {
                return slotReq.maxMoves.maxMoves[i].target;
            }
            return moves[i].target;
        };
        const choose = async i => {
            setBusy(true);
            try {
                let target = null;
                const targets = bridge.targetsFor(slot, targetOf(i));
                if (targets) {
                    target = await pickTarget(targets, bridge);
                    if (target === null) {
                        return;
                    }
                }
                pick({ type: "move", slot: i, target, gimmick });
            } finally {
                setBusy(false);
            }
        };
        const cycleGimmick = () => {
            if (!gimmicks.length) {
                SoundManager.playBuzzer();
                return;
            }
            SoundManager.playCursor();
            const order = [""].concat(gimmicks);
            setGimmick(order[(order.indexOf(gimmick) + 1) % order.length]);
        };
        const cursor = useCursorList(moves.length, {
            columns: 2,
            onOk: choose,
            onCancel: back,
            onChange: setSel,
            isEnabled: i => !moves[i].disabled && moves[i].pp > 0 && (gimmick !== "zmove" || !!(slotReq.canZMove && slotReq.canZMove[i])),
            handlers: { shift: cycleGimmick },
            priority: busy ? -1 : 2,
        });
        const m = moves[sel];
        const data = m ? PBS.moves.tryGet(m.id) : null;
        const gLabel = g => tr(`Battle.Gimmick.${g}`, { mega: "MEGA", zmove: "Z-MOVE", dynamax: "DYNAMAX", terastallize: "TERA" }[g]);
        return html`<div class="pmz-pk-battle-moves">
            <div class="pmz-panel pmz-pk-battle-movelist">
                <div class="pmz-list" role="menu" style=${{ "--pmz-columns": 2 }} ...${cursor.listProps}>
                    ${moves.map((mv, i) => html`<div key=${mv.id} role="menuitem" ...${cursor.itemProps(i)}>${labelOf(mv, i)}</div>`)}
                </div>
            </div>
            <div class="pmz-panel pmz-pk-battle-moveinfo">
                <div>${tr("Pkmn.PP", "PP")} ${m ? `${m.pp}/${m.maxpp}` : ""}</div>
                <div>${tr("Battle.TypeLabel", "TYPE/")}${data ? html`<${TypeBadge} type=${data.type} />` : null}</div>
                ${gimmicks.length
                    ? html`<${Button} class=${`pmz-pk-gimmick ${gimmick ? "is-on" : ""}`} onPress=${cycleGimmick} sound="">
                          ${gimmick ? gLabel(gimmick) : tr("Battle.Gimmick.Off", "Shift: {g}", { g: gimmicks.map(gLabel).join(" / ") })}
                      <//>`
                    : null}
            </div>
            <${BackButton} onPress=${back} class="pmz-pk-battle-back" />
        </div>`;
    }

    //=========================================================================
    // Town Map (and Fly)
    //=========================================================================

    /**
     * @brief Where a map is on the Town Map: its own map_metadata townMap,
     *        else its parent map's (MapInfos tree).
     * @param {number} mapId MZ map ID.
     * @return {Array|null} [regionId, x, y].
     */
    function townMapPosition(mapId) {
        let id = mapId;
        const seen = new Set();
        while (id && !seen.has(id)) {
            seen.add(id);
            const meta = PBS.mapMetadataFor(id);
            if (meta && meta.townMap) {
                return meta.townMap;
            }
            id = $dataMapInfos[id] ? $dataMapInfos[id].parentId : 0;
        }
        return null;
    }

    /**
     * @brief Whether a Town Map point can be flown to.
     * @param {Object} point Town map point.
     * @return {boolean} True if Fly can go there.
     */
    function canFlyTo(point) {
        if (!point || !point.flyTo) {
            return false;
        }
        if (point.switch) {
            return $gameSwitches.value(point.switch);
        }
        return !!($gamePokemon.visitedMaps || {})[point.flyTo[0]];
    }

    /** @brief The Town Map screen; props {mode: "view" | "fly"}. */
    function TownMapScreen({ close, mode = "view" }) {
        UI.useStrings();
        const regions = PBS.townMap.ids();
        const here = townMapPosition($gameMap.mapId());
        const [regionIndex, setRegionIndex] = useState(() => Math.max(0, here ? regions.indexOf(here[0]) : 0));
        const region = regions.length ? PBS.townMap.get(regions[regionIndex]) : null;
        const [cur, setCur] = useState(() => (here && region && here[0] === region.id ? { x: here[1], y: here[2] } : { x: 0, y: 0 }));
        const [image, setImage] = useState(null);
        const [busy, setBusy] = useState(false);
        const count = UI.useFrameCount();
        const imgRef = useRef(null);
        useEffect(() => {
            let alive = true;
            setImage(null);
            if (region && region.image && window.PokeMZ.Graphics) {
                window.PokeMZ.Graphics.tryLoad(`img/townmap/${encodeURIComponent(region.image)}.png`).then(b => alive && setImage(b));
            }
            return () => (alive = false);
        }, [region && region.id]);
        useLayoutEffect(() => {
            const canvas = imgRef.current;
            if (canvas && image) {
                const ctx = canvas.getContext("2d");
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(image.canvas, 0, 0, canvas.width, canvas.height);
            }
        }, [image]);
        if (!region) {
            return html`<div class="pmz-pk-screen pmz-pk-townmap">
                <${HelpBar} text=${tr("TownMap.None", "There is no map data.")} onBack=${close} />
            </div>`;
        }
        const [cols, rows] = region.size;
        const cell = Math.floor(Math.min(768 / cols, 456 / rows));
        const pointAt = (x, y) => region.points.findIndex(p => p.x === x && p.y === y);
        const pi = pointAt(cur.x, cur.y);
        const point = pi >= 0 ? region.points[pi] : null;
        const move = (dx, dy) => {
            setCur({ x: Math.max(0, Math.min(cols - 1, cur.x + dx)), y: Math.max(0, Math.min(rows - 1, cur.y + dy)) });
            SoundManager.playCursor();
        };
        const fly = async () => {
            if (mode !== "fly") {
                return;
            }
            if (!canFlyTo(point)) {
                SoundManager.playBuzzer();
                return;
            }
            setBusy(true);
            const ok = await UI.confirm(tr("TownMap.FlyConfirm", "Fly to {place}?", { place: region.pointName(pi) }));
            setBusy(false);
            if (ok) {
                const [mapId, x, y] = point.flyTo;
                close();
                $gamePlayer.reserveTransfer(mapId, x, y, 2, 0);
            }
        };
        useFocus(
            {
                left: () => move(-1, 0),
                right: () => move(1, 0),
                up: () => move(0, -1),
                down: () => move(0, 1),
                ok: fly,
                shift: () => regions.length > 1 && (SoundManager.playCursor(), setRegionIndex((regionIndex + 1) % regions.length)),
                cancel: () => (SoundManager.playCancel(), close()),
            },
            { priority: busy ? -1 : 0 }
        );
        const style = (x, y) => ({ left: `${x * cell}px`, top: `${y * cell}px`, width: `${cell}px`, height: `${cell}px` });
        const label = point ? region.pointName(pi) : "";
        return html`<div class=${`pmz-pk-screen pmz-pk-townmap ${mode === "fly" ? "is-fly" : ""}`}>
            <div class="pmz-panel pmz-pk-townmap-head">
                <span>${region.name}</span>
                <span>${mode === "fly" ? tr("TownMap.FlyTitle", "Where do you want to fly?") : tr("TownMap.Title", "Town Map")}</span>
            </div>
            <div class="pmz-pk-townmap-area" style=${{ width: `${cols * cell}px`, height: `${rows * cell}px` }} role="grid" aria-label=${region.name}>
                ${image ? html`<canvas ref=${imgRef} class="pmz-image pmz-pk-townmap-image" width=${cols * cell} height=${rows * cell} />` : html`<div class="pmz-pk-townmap-grid" style=${{ backgroundSize: `${cell}px ${cell}px` }}></div>`}
                ${region.points.map(
                    (p, i) => html`<div
                        key=${i}
                        class=${`pmz-pk-townmap-point ${p.flyTo ? "is-town" : ""} ${mode === "fly" && canFlyTo(p) ? "can-fly" : ""}`}
                        style=${style(p.x, p.y)}
                        onPointerUp=${() => setCur({ x: p.x, y: p.y })}
                    ></div>`
                )}
                ${here && here[0] === region.id && Math.floor(count / 20) % 2 === 0 ? html`<div class="pmz-pk-townmap-player" style=${style(here[1], here[2])} aria-label=${tr("TownMap.You", "You are here")}></div>` : null}
                <div class="pmz-pk-townmap-cursor" style=${style(cur.x, cur.y)}></div>
            </div>
            <div class="pmz-panel pmz-pk-help pmz-pk-townmap-bar" aria-live="polite">
                <span>
                    <b>${label}</b>
                    ${point && point.poi ? html` — ${tr(`TownMap.Poi.${PBS.toID(point.poi)}`, point.poi)}` : null}
                    ${regions.length > 1 ? html` <small>${tr("TownMap.SwitchRegion", "Shift: region")}</small>` : null}
                </span>
                <${BackButton} onPress=${close} />
            </div>
        </div>`;
    }

    // Fly: from the party menu, outdoors.
    Pkmn.FieldMoves.register("fly", {
        canUse: () => {
            const meta = PBS.mapMetadataFor($gameMap.mapId());
            return !!(meta && meta.outdoor) && PBS.townMap.size > 0;
        },
        async use() {
            // Wait until the map is back before opening the Town Map.
            while (!(SceneManager._scene instanceof Scene_Map) || SceneManager.isSceneChanging()) {
                await UI.wait(1);
            }
            UI.openScreen("townMap", { mode: "fly" });
        },
    });

    //=========================================================================
    // Trade overlay
    //=========================================================================

    /**
     * @brief Plays the trade sequence: the sent Pokémon leaves, the
     *        received one arrives.
     * @param {Game_Pokemon} sent Pokémon sent (already removed).
     * @param {Game_Pokemon} got Pokémon received.
     * @param {Object} o {npc, sent (name)}.
     * @return {Promise<void>} Done.
     */
    function showTrade(sent, got, o) {
        return modal(done => {
            function TradeView() {
                const [phase, setPhase] = useState("send");
                useEffect(() => {
                    (async () => {
                        const player = $gameParty.leader() ? $gameParty.leader().name() : "";
                        await UI.message(tr("Trade.Msg.Sending", "{player} sent over {name}.", { player, name: o.sent }));
                        setPhase("swap");
                        await UI.wait(50);
                        setPhase("receive");
                        SoundManager.playRecovery();
                        await UI.message(tr("Trade.Msg.Received", "{npc} sent over {name}.", { npc: o.npc, name: got.name() }));
                        done();
                    })();
                }, []);
                return html`<div class="pmz-pk-screen pmz-pk-trade" aria-live="polite">
                    <div class=${`pmz-pk-trade-mon is-${phase}`}>
                        ${phase === "receive"
                            ? html`<${PokemonImage} pokemon=${got} view="front" scale=${3} />`
                            : html`<${PokemonImage} pokemon=${sent} view="front" scale=${3} />`}
                    </div>
                    <div class="pmz-pk-trade-link" aria-hidden="true"></div>
                </div>`;
            }
            return html`<${TradeView} />`;
        });
    }

    //=========================================================================
    // Registration
    //=========================================================================

    UI.registerScreen("party", PartyScreen, { transition: "fade" });
    UI.registerScreen("bag", BagScreen, { transition: "fade" });
    UI.registerScreen("pokedex", PokedexScreen, { transition: "fade" });
    UI.registerScreen("pc", PcScreen, { transition: "fade" });
    UI.registerScreen("moveReminder", MoveReminderScreen, { transition: "none", backgroundOpacity: 255, blur: false });
    UI.registerScreen("dayCare", DayCareScreen, { transition: "none", backgroundOpacity: 255, blur: false });
    UI.registerScreen("townMap", TownMapScreen, { transition: "fade" });
    UI.registerScreen("pokegear", TownMapScreen, { transition: "fade" });
    UI.registerScreen("battle", BattleScreen, { transition: "fade", blur: false, backgroundOpacity: 0 });

    window.PokeMZ.PokemonUI = {
        modal,
        pickPokemon,
        pickItem,
        pickMove,
        pickCommand,
        showSummary,
        pickTarget,
        townMapPosition,
        canFlyTo,
        showTrade,
        components: { PokemonImage, PokemonIcon, HpBar, ExpBar, TypeBadge, Gender, StatusBadge, PartyView, BagView, SummaryView },
    };
})();

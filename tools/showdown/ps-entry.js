/**
 * @file ps-entry.js
 * @brief Bundle entry point that exposes the Showdown simulator to MZ.
 *
 * Bundled by tools/build-showdown.js into js/plugins/PS_Sim.js as the
 * global `PSSim`.
 */
export { Battle, BattleStreams, Dex, Teams, toID } from "@pkmn/sim";

/**
 * Charactermancer Integration
 * Intercepts Roll20's compendium GraphQL API and injects 5etools class/race/background
 * data into the Charactermancer wizard when the user does not own the PHB.
 */
function d20plus2024Charactermancer () {
	const GRAPHQL_HOST = "compendium.production.roll20preflight.net/graphql";
	const CDN_BASE = "https://storage.googleapis.com/roll20-cdn/advanced-sheets-production-9b1f7af9/dnd2024byroll20/assets/compendium";
	const GENERIC_CLASS_IMG    = `${CDN_BASE}/generic-class.png`;
	const GENERIC_SPECIES_IMG  = `${CDN_BASE}/generic-species.svg`;
	const PHB_BOOK = {name: "Player's Handbook", itemId: "5", isOwned: true, systemVersion: "2014", marketplaceLink: null};

	// Roll20 PHB artwork — keyed by class/race name as it appears in 5etools
	const CLASS_IMG = {
		"Barbarian": `${CDN_BASE}/webp/classes/Barbarian-PHB.webp`,
		"Bard":      `${CDN_BASE}/webp/classes/Bard-PHB.webp`,
		"Cleric":    `${CDN_BASE}/webp/classes/Cleric-PHB.webp`,
		"Druid":     `${CDN_BASE}/webp/classes/Druid-PHB.webp`,
		"Fighter":   `${CDN_BASE}/webp/classes/Fighter-PHB.webp`,
		"Monk":      `${CDN_BASE}/webp/classes/Monk-PHB.webp`,
		"Paladin":   `${CDN_BASE}/webp/classes/Paladin-PHB.webp`,
		"Ranger":    `${CDN_BASE}/webp/classes/Ranger-PHB.webp`,
		"Rogue":     `${CDN_BASE}/webp/classes/Rogue-PHB.webp`,
		"Sorcerer":  `${CDN_BASE}/webp/classes/Sorcerer-PHB.webp`,
		"Warlock":   `${CDN_BASE}/webp/classes/Warlock-PHB.webp`,
		"Wizard":    `${CDN_BASE}/webp/classes/Wizard-PHB.webp`,
	};
	const RACE_IMG = {
		"Dragonborn": `${CDN_BASE}/webp/species/Dragonborn-PHB.webp`,
		"Dwarf":      `${CDN_BASE}/webp/species/Dwarf-PHB.webp`,
		"Elf":        `${CDN_BASE}/webp/species/Elf-PHB.webp`,
		"Gnome":      `${CDN_BASE}/webp/species/Gnome-PHB.webp`,
		"Half-Elf":   `${CDN_BASE}/webp/species/Half-Elf-PHB.webp`,
		"Half-Orc":   `${CDN_BASE}/webp/species/Half-Orc-PHB.webp`,
		"Halfling":   `${CDN_BASE}/webp/species/Halfling-PHB.webp`,
		"Human":      `${CDN_BASE}/webp/species/Human-PHB.webp`,
		"Tiefling":   `${CDN_BASE}/webp/species/Tiefling-PHB.webp`,
	};

	const ABV = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};

	// Explicit language list so Language Choice dropdowns populate without depending on
	// Roll20's category(name:"Languages") query (which requires PHB ownership to return data)
	const STD_LANGUAGES = [
		"Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc",
		"Abyssal", "Celestial", "Draconic", "Deep Speech", "Infernal", "Primordial", "Sylvan", "Undercommon",
	];
	const CASTER_MAP = {"full": "full", "1/2": "half", "1/3": "third", "artificer": "half", "pact": "pact"};
	const SIZE_MAP = {T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan"};
	// 5etools → Roll20 weapon property names
	const ITEM_PROP = {
		F:"Finesse", L:"Light", T:"Thrown", V:"Versatile", "2H":"Two-Handed",
		H:"Heavy", R:"Reach", A:"Ammunition", LD:"Loading", S:"Special",
	};
	// 5etools → Roll20 damage type names
	const ITEM_DMG = {
		B:"Bludgeoning", P:"Piercing", S:"Slashing", N:"Necrotic", F:"Fire",
		C:"Cold", L:"Lightning", A:"Acid", T:"Thunder", R:"Radiant", Y:"Psychic",
		O:"Force", I:"Poison",
	};
	// List name → filter criteria used to query category(name:"Items")
	const STANDARD_LISTS = {
		"Simple Weapons":        [{key:"Subtype",value:"simple"},{key:"Item Rarity",value:"None, Standard"}],
		"Martial Weapons":       [{key:"Subtype",value:"martial"},{key:"Item Rarity",value:"None, Standard"}],
		"Simple Melee Weapons":  [{key:"Subtype",value:"simple"},{key:"Item Type",value:"Melee Weapon"},{key:"Item Rarity",value:"None, Standard"}],
		"Simple Ranged Weapons": [{key:"Subtype",value:"simple"},{key:"Item Type",value:"Ranged Weapon"},{key:"Item Rarity",value:"None, Standard"}],
		"Martial Melee Weapons": [{key:"Subtype",value:"martial"},{key:"Item Type",value:"Melee Weapon"},{key:"Item Rarity",value:"None, Standard"}],
		"Martial Ranged Weapons":[{key:"Subtype",value:"martial"},{key:"Item Type",value:"Ranged Weapon"},{key:"Item Rarity",value:"None, Standard"}],
	};

	const ARMOR_CLEAN = {
		"light": "Light Armor", "medium": "Medium Armor", "heavy": "Heavy Armor",
		"shield": "Shields", "shields": "Shields",
	};
	const WEAPON_CLEAN = {
		"simple": "Simple Weapons", "martial": "Martial Weapons",
		"simple melee": "Simple Weapons", "simple ranged": "Simple Weapons",
		"martial melee": "Martial Weapons", "martial ranged": "Martial Weapons",
	};

	// ── Data cache ───────────────────────────────────────────────────────────

	let _clsP = null, _raceP = null, _bgP = null, _subclsP = null, _featP = null, _subraceP = null, _itemsP = null, _packsP = null, _gearP = null;
	// Cache our synthesised entries by id so page(id:...) queries can be answered
	const _pageCache = new Map();

	function getClasses () {
		if (!_clsP) _clsP = DataLoader.pCacheAndGetAllSite("class").catch(() => []);
		return _clsP;
	}
	function getRaces () {
		if (!_raceP) _raceP = DataLoader.pCacheAndGetAllSite("race")
			.then(arr => Renderer.race.mergeSubraces(arr || []))
			.catch(() => []);
		return _raceP;
	}
	function getBackgrounds () {
		if (!_bgP) _bgP = DataUtil.loadJSON(BACKGROUND_DATA_URL)
			.then(d => d.background || [])
			.catch(() => []);
		return _bgP;
	}

	function getItems () {
		if (!_itemsP) {
			_itemsP = (async () => {
				const result = [];
				const seen   = new Set();
				if (typeof JSON_DATA !== "undefined") {
					for (const data of Object.values(JSON_DATA)) {
						if (!data?.baseitem) continue;
						for (const item of data.baseitem) {
							if (!item.name || !item.weaponCategory) continue;
							if (item.type !== "M" && item.type !== "R") continue;
							const key = item.name.toLowerCase();
							if (seen.has(key)) continue;
							seen.add(key);
							result.push(item);
						}
					}
				}
				d20plus.ut.log(`[Charactermancer] Loaded ${result.length} weapon items`);
				return result;
			})().catch(() => []);
		}
		return _itemsP;
	}

	function getGear () {
		if (!_gearP) {
			_gearP = (async () => {
				const result = [];
				const seen   = new Set();
				if (typeof JSON_DATA !== "undefined") {
					for (const data of Object.values(JSON_DATA)) {
						if (!data?.item) continue;
						for (const item of data.item) {
							if (!item.name || item.weaponCategory) continue; // skip weapons (already in getItems)
							// Types can have source suffixes like "G|XPHB" — match on the base type
			const baseType = (item.type || "").split("|")[0];
			if (!["G","AT","A","EXP","INS","GS","MNT","VEH","SHP","AIR","SPC"].includes(baseType)) continue;
							const key = item.name.toLowerCase();
							if (seen.has(key)) continue;
							seen.add(key);
							result.push(item);
						}
					}
				}
				return result;
			})().catch(() => []);
		}
		return _gearP;
	}

	function getPacks () {
		if (!_packsP) {
			_packsP = (async () => {
				const result = [];
				const seen   = new Set();
				if (typeof JSON_DATA !== "undefined") {
					for (const data of Object.values(JSON_DATA)) {
						if (!data?.item) continue;
						for (const item of data.item) {
							if (!item.name || !item.packContents?.length) continue;
							if (item.type !== "G" && item.type !== "G|XPHB") continue;
							const key = item.name.toLowerCase();
							if (seen.has(key)) continue;
							seen.add(key);
							result.push(item);
						}
					}
				}
				return result;
			})().catch(() => []);
		}
		return _packsP;
	}

	// Parse a single packContents entry into {name, qty}
	function packItemToNameQty (raw) {
		let base, qty;
		if (typeof raw === "string") {
			base = cleanItem(raw);
			qty  = 1;
		} else if (raw?.item) {
			const s = raw.item.split("|")[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
			base = s.charAt(0).toUpperCase() + s.slice(1);
			qty  = raw.quantity || 1;
		} else {
			return null;
		}
		return base ? {name: base, qty} : null;
	}

	function getSubraces () {
		if (!_subraceP) {
			_subraceP = (async () => {
				const result = [];

				// Helper: expand a _versions block into synthetic subrace entries
				function expandVersions (raceName, raceSource, source, versionsArr) {
					for (const version of versionsArr) {
						for (const impl of (version._implementations || [])) {
							const vars = impl._variables || {};
							const colorName = vars.color || vars.name;
							if (!colorName) continue;
							result.push({
								name: colorName,
								raceName,
								raceSource,
								source,
								_expandedVars: vars,
								_expandedResist: impl.resist || [],
							});
						}
					}
				}

				if (typeof JSON_DATA !== "undefined") {
					for (const data of Object.values(JSON_DATA)) {
						// Named subraces and subrace _versions
						for (const sub of (data.subrace || [])) {
							if (!sub?.raceName) continue;
							if (sub.name) {
								result.push(sub);
							} else if (sub._versions) {
								expandVersions(sub.raceName, sub.raceSource, sub.source, sub._versions);
							}
						}
						// Top-level races with _versions (e.g. XPHB Dragonborn, FTD variants)
						// These races carry their own ancestry variants — surface them as virtual subraces
						for (const race of (data.race || [])) {
							if (!race?._versions || !race?.name) continue;
							const hasImpls = race._versions.some(v => v._implementations?.length);
							if (!hasImpls) continue;
							expandVersions(race.name, race.source, race.source, race._versions);
						}
					}
				}

				if (result.length) {
					d20plus.ut.log(`[Charactermancer] Loaded ${result.length} subraces (including expanded versions)`);
					return result;
				}
				return DataLoader.pCacheAndGetAllSite("race")
					.then(arr => (arr || []).filter(r => r.raceName && r.name))
					.catch(() => []);
			})().catch(() => []);
		}
		return _subraceP;
	}

	function getSubclasses () {
		if (!_subclsP) {
			_subclsP = (async () => {
				// Class data files contain both "subclass" and "subclassFeature" as separate top-level arrays.
				// Scan JSON_DATA directly so we can join them without a second DataLoader call.
				const result = [];

				if (typeof JSON_DATA !== "undefined") {
					for (const data of Object.values(JSON_DATA)) {
						if (!data?.subclass?.length || !data?.subclassFeature?.length) continue;

						// Build className::shortName → features[] map for this file
						const featMap = {};
						for (const feat of data.subclassFeature) {
							if (!feat?.className || !feat?.subclassShortName) continue;
							const key = `${feat.className}::${feat.subclassShortName}`.toLowerCase();
							(featMap[key] || (featMap[key] = [])).push(feat);
						}

						for (const sub of data.subclass) {
							if (!sub?.name || !sub?.className) continue;
							const key = `${sub.className}::${sub.shortName}`.toLowerCase();
							const enriched = {...sub, _features: featMap[key] || []};
							// Replace any existing entry with same class+shortName (keeps newest/last version)
							const idx = result.findIndex(s =>
								s.className?.toLowerCase() === sub.className?.toLowerCase() &&
								s.shortName?.toLowerCase() === sub.shortName?.toLowerCase());
							if (idx >= 0) result[idx] = enriched;
							else result.push(enriched);
						}
					}
				}

				if (result.length) {
					d20plus.ut.log(`[Charactermancer] Loaded ${result.length} subclasses`);
					return result;
				}

				// Fallback: DataLoader (may not have subclassFeature resolved)
				return DataLoader.pCacheAndGetAllSite("subclass").catch(() => []);
			})().catch(() => []);
		}
		return _subclsP;
	}

	function getFeats () {
		if (!_featP) {
			_featP = (async () => {
				if (typeof JSON_DATA !== "undefined") {
					for (const data of Object.values(JSON_DATA)) {
						if (data && data.feat && data.feat.length > 50) return data.feat;
					}
				}
				return DataLoader.pCacheAndGetAllSite("feat").catch(() => []);
			})().catch(() => []);
		}
		return _featP;
	}

	// ── Utilities ────────────────────────────────────────────────────────────

	// Deterministic 24-char hex id from a string seed
	function makeId (seed) {
		let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
		for (let i = 0; i < seed.length; i++) {
			const c = seed.charCodeAt(i);
			h1 = Math.imul(h1 ^ c, 2654435761);
			h2 = Math.imul(h2 ^ c, 1597334677);
		}
		h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
		h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
		return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(24, "0").slice(0, 24);
	}

	function stripHtml (html) {
		return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	}

	function renderDesc (entries) {
		if (!entries?.length) return "";
		const stack = [];
		Renderer.get().recursiveRender({entries}, stack);
		return stripHtml(stack.join(""));
	}

	function cleanProf (raw) {
		return raw.replace(/\{@[a-z]+\s+/gi, "").replace(/\}/g, "").trim();
	}

	function book (source) {
		return {
			name: Parser.sourceJsonToFull(source) || source,
			itemId: null, systemVersion: "", isOwned: true,
			cost: 0, marketplaceLink: null, coverImage: null, notForSale: false, bundles: [],
		};
	}

	function pay (obj) { return JSON.stringify(obj); }

	// ── General record builders ───────────────────────────────────────────────

	function choiceRecord(name, choicesCount = 1, parentName = undefined, level = 1) {
		return {
			name: "", parent: parentName, level: level,
			payload: pay({type:"Generic Choice",category:"",replace:false,numOfChoices:choicesCount})
		}
	}

	function defenseRecord(defType, damageType, parentName = undefined, level = 1) {
		const damageName = damageType.toTitleCase();

		return {
			name: `${damageName} ${defType}`, parent: parentName, level: level,
			payload: pay({type:"Defense",defense:defType,damage:damageName}),
		}
	}

	function defenseRecords(defType, list, level = 1) {
		const recs = [];

		if (!list || !(list.length > 0))
			return recs;

		// Choice counter in case there are multiple choices
		let choiceNum = 1

		// Add resistances
		for (r of list) {
			if (r.choose?.from?.length > 0) {
				// Handle choice (This code is untested)
				const choiceName = defType + " Choice " + choiceNum
				recs.push(choiceRecord(choiceName, 1, undefined, level));

				for (choice of r.choose.from) {
					recs.push(defenseRecord(defType, r, choiceName, level));
				}
			}
			else
				recs.push(defenseRecord(defType, r, undefined, level));
		}

		return recs
	}

	// ── Class helpers ─────────────────────────────────────────────────────────

	function savingThrows (cls) {
		return (cls.proficiency || []).map(a => ABV[a] || a);
	}

	function subclassLevel (cls) {
		for (let i = 0; i < (cls.classFeatures?.length ?? 0); i++) {
			if ((cls.classFeatures[i] || []).some(f => f?.gainSubclassFeature)) return i + 1;
		}
		return 3;
	}

	function asiLevels (cls) {
		const lvls = [];
		for (let i = 0; i < (cls.classFeatures?.length ?? 0); i++) {
			if ((cls.classFeatures[i] || []).some(f => f?.name === "Ability Score Improvement")) lvls.push(String(i + 1));
		}
		return lvls.length ? lvls : ["4", "8", "12", "16", "19"];
	}

	function armorProfs (cls) {
		return (cls.startingProficiencies?.armor || [])
			.map(a => ARMOR_CLEAN[cleanProf(a).toLowerCase()] || (cleanProf(a).charAt(0).toUpperCase() + cleanProf(a).slice(1)));
	}

	function weaponProfs (cls) {
		return (cls.startingProficiencies?.weapons || [])
			.map(w => WEAPON_CLEAN[cleanProf(w).toLowerCase()] || (cleanProf(w).charAt(0).toUpperCase() + cleanProf(w).slice(1)));
	}

	function startingGold (cls) {
		const hd = cls.hd?.faces ?? 8;
		if (hd >= 10) return "5d4*10";
		if (hd >= 8)  return "4d4*10";
		return "3d4*10";
	}

	// ── Spell slot records (incremental) ──────────────────────────────────────

	function spellSlotRecords (clsName, parentName, table, isPact) {
		const records = [];
		const prev = new Array(10).fill(0);
		let prevPactName = null;

		for (let lvl = 0; lvl < table.length; lvl++) {
			const row = table[lvl] || [];

			if (isPact) {
				// Pact casters: one slot level that changes over time, use overwrite chain
				for (let sp = row.length - 1; sp >= 0; sp--) {
					const cnt = row[sp] || 0;
					if (!cnt) continue;
					const recName = `${clsName} Pact Slots (${lvl + 1})`;
					const rec = {
						name: recName,
						parent: parentName,
						level: String(lvl + 1),
						payload: pay({type: "Spell Slot", spellLevel: sp + 1, calculation: "Set Base", valueFormula: {flatValue: cnt}}),
					};
					if (prevPactName) rec.overwrite = prevPactName;
					records.push(rec);
					prevPactName = recName;
					break;
				}
			} else {
				for (let sp = 0; sp < row.length; sp++) {
					const cnt = row[sp] || 0;
					const old = prev[sp];
					if (cnt === old || cnt === 0) continue;
					records.push({
						name: `${clsName} Level ${sp + 1} Slots (${lvl + 1})`,
						parent: parentName,
						level: String(lvl + 1),
						payload: pay({
							type: "Spell Slot",
							spellLevel: sp + 1,
							calculation: old === 0 ? "Set Base" : "Modify",
							valueFormula: {flatValue: old === 0 ? cnt : cnt - old},
						}),
					});
					prev[sp] = cnt;
				}
			}
		}
		return records;
	}

	// ── Equipment helpers ─────────────────────────────────────────────────────

	const EQUIP_TYPE_MAP = {
		weaponMartial:          "Lists:Martial Weapons",
		weaponMartialMelee:     "Lists:Martial Melee Weapons",
		weaponMartialRanged:    "Lists:Martial Ranged Weapons",
		weaponSimple:           "Lists:Simple Weapons",
		weaponSimpleMelee:      "Lists:Simple Melee Weapons",
		weaponSimpleRanged:     "Lists:Simple Ranged Weapons",
		focusSpellcastingHoly:  "Lists:Holy Symbols",
		focusSpellcastingArcane: "Lists:Arcane Focus",
		focusSpellcastingDruidic: "Lists:Druidic Focus",
		instrumentMusical:      "Lists:Musical Instruments",
		toolArtisan:            "Lists:Artisan's Tools",
	};

	function cleanItem (raw) {
		// "chain mail|phb" → "Chain Mail"
		const s = raw.split("|")[0].trim();
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	function parseGold (raw) {
		if (!raw) return "5d4*10";
		const m = raw.match(/(\d+d\d+)/i);
		return m ? m[1] + "*10" : "5d4*10";
	}

	// Convert a single defaultData item to {items, numOfChoices}
	// Keep pack names as a SINGLE item in the items array — the Charactermancer uses this for
	// display and to look up the Items entry.  Individual item expansion happens in buildPackEntry.
	function eqItemToR20 (item) {
		if (typeof item === "string") {
			return {items: [cleanItem(item)], numOfChoices: 1};
		}
		if (item.equipmentType) {
			return {
				items: [EQUIP_TYPE_MAP[item.equipmentType] || item.equipmentType],
				numOfChoices: item.quantity || 1,
			};
		}
		if (item.item) {
			const name = cleanItem(item.item);
			const qty  = item.quantity || 1;
			const displayName = qty > 1 ? `${name} (${qty})` : name;
			return {items: [displayName], numOfChoices: 1};
		}
		return {items: [], numOfChoices: 1};
	}

	// Build Starting Equipment records from cls.startingEquipment.defaultData
	function buildEquipRecords (cls, basicsName) {
		const recs = [];
		const n = cls.name;
		const eqData = cls.startingEquipment?.defaultData;
		const goldStr = parseGold(cls.startingEquipment?.goldAlternative);

		const eqChoiceName = `${n} Equipment Choice`;
		recs.push({
			name: eqChoiceName, parent: basicsName, level: "1",
			builderDisplayName: "Equipment Choice", multiclass: "FALSE",
			payload: pay({type: "Starting Equipment", subtype: "choice", items: [], numOfChoices: 1}),
		});
		recs.push({
			name: `${n} Starting Gold`, parent: eqChoiceName, level: "1",
			builderDisplayName: "Starting Currency", multiclass: "FALSE",
			payload: pay({type: "Starting Currency", gold: goldStr}),
		});

		if (!eqData?.length) return recs;

		// Fixed equipment container (sibling of gold)
		const eqContName = `${n} Equipment`;
		recs.push({
			name: eqContName, parent: eqChoiceName, level: "1",
			multiclass: "FALSE",
			payload: pay({type: "Starting Equipment", subtype: "fixed", items: []}),
		});

		let choiceIdx = 0;
		for (const group of eqData) {
			const keys = Object.keys(group);

			if (keys.includes("_")) {
				// Always-given fixed items
				const items = group._.flatMap(i => eqItemToR20(i).items);
				if (items.length) {
					recs.push({
						name: `${n} Fixed Equipment`, parent: eqContName, level: "1",
						builderDisplayName: "Fixed Equipment", multiclass: "FALSE",
						payload: pay({type: "Starting Equipment", subtype: "fixed", items}),
					});
				}
			} else {
				// A/B (or more) choice
				choiceIdx++;
				const choiceName = `${n} Equipment Choice ${choiceIdx}`;

				// For choices where every option is exactly one named item (no lists, no bundles),
				// put all option names directly in the choice record's items[]. The Charactermancer
				// silently skips binary fixed-child choices but handles items[] correctly.
				const isFlatNamed = Object.values(group).every(optItems => {
					if (optItems.length !== 1) return false;
					const r = eqItemToR20(optItems[0]);
					return r.items.length === 1 && !r.items[0].startsWith("Lists:");
				});

				if (isFlatNamed) {
					const optionItems = keys.map(k => eqItemToR20(group[k][0]).items[0]);
					// When the parent choice builderDisplayName matches a child's name, the Charactermancer
					// queries that item twice and auto-applies it. Use a distinct label for binary choices
					// so the parent and children never share a query key.
					const displayName = optionItems.length === 2
						? `${optionItems[0]} or ${optionItems[1]}`
						: optionItems[0];
					recs.push({
						name: choiceName, parent: eqContName, level: "1",
						builderDisplayName: displayName, multiclass: "FALSE",
						payload: pay({type: "Starting Equipment", subtype: "choice", items: [], numOfChoices: 1}),
					});
					for (const [k, v] of Object.entries(group)) {
						const itemName = eqItemToR20(v[0]).items[0];
						// Synthetic record name (e.g. "Cleric Equipment Choice 1 A") prevents
						// the class child record from adding a duplicate dropdown entry alongside
						// the Items compendium entry for the same item name.
						recs.push({
							name: `${choiceName} ${k.toUpperCase()}`, parent: choiceName, level: "1",
							builderDisplayName: itemName, multiclass: "FALSE",
							payload: pay({type: "Starting Equipment", subtype: "fixed", items: [itemName]}),
						});
					}
				} else {
					// Complex choice: multi-item options, or options with list items
					const firstKey   = keys[0];
					const firstName  = group[firstKey]?.map?.(i => eqItemToR20(i).items[0]).filter(Boolean).join(" + ") || `Choice ${choiceIdx}`;
					recs.push({
						name: choiceName, parent: eqContName, level: "1",
						builderDisplayName: firstName, multiclass: "FALSE",
						payload: pay({type: "Starting Equipment", subtype: "choice", items: [], numOfChoices: 1}),
					});

					for (const [opt, optItems] of Object.entries(group)) {
						const label = opt.toUpperCase();

						const listItems  = [];
						const namedItems = [];
						let   numChoices = 1;

						for (const raw of optItems) {
							const result = eqItemToR20(raw);
							for (const it of result.items) {
								if (it.startsWith("Lists:")) { listItems.push(it); numChoices = result.numOfChoices; }
								else namedItems.push(it);
							}
						}

						if (listItems.length && namedItems.length) {
							const bundleName = `${n} Equipment ${label}`;
							recs.push({
								name: bundleName, parent: choiceName, level: "1",
								builderDisplayName: `${namedItems.join(", ")} + weapon`, multiclass: "FALSE",
								payload: pay({type: "Starting Equipment", subtype: "fixed", items: namedItems}),
							});
							recs.push({
								name: `${n} Equipment ${label} Weapon`, parent: bundleName, level: "1",
								multiclass: "FALSE",
								payload: pay({type: "Starting Equipment", subtype: "choice", items: listItems, numOfChoices: numChoices}),
							});
						} else if (listItems.length) {
							recs.push({
								name: `${n} Equipment ${label}`, parent: choiceName, level: "1",
								builderDisplayName: `Option ${label}`, multiclass: "FALSE",
								payload: pay({type: "Starting Equipment", subtype: "choice", items: listItems, numOfChoices: numChoices}),
							});
						} else {
							const recName  = namedItems.length === 1 ? namedItems[0] : `${n} Equipment ${label}`;
							const dispName = namedItems.join(", ") || `Option ${label}`;
							recs.push({
								name: recName, parent: choiceName, level: "1",
								builderDisplayName: dispName, multiclass: "FALSE",
								payload: pay({type: "Starting Equipment", subtype: "fixed", items: namedItems}),
							});
						}
					}
				}
			}
		}

		return recs;
	}

	// ── Build data-datarecords for a class ────────────────────────────────────

	function buildClassRecords (cls) {
		const recs = [];
		const n = cls.name;
		const basicsName = `${n} Basics`;
		const spellAbility = cls.spellcastingAbility ? ABV[cls.spellcastingAbility] : null;
		const casterType   = spellAbility ? (CASTER_MAP[cls.casterProgression] || "full") : null;
		const isPact       = casterType === "pact";
		const isPooled     = !!cls.preparedSpells || ["half", "third"].includes(casterType);
		const spellTable   = cls.classTableGroups?.find(g => g.rowsSpellProgression)?.rowsSpellProgression;

		// Class Details
		recs.push({
			name: basicsName,
			level: "1",
			payload: pay({
				type: "Class Details",
				subclassName: cls.subclassTitle || `${n} Subclass`,
				suggestedAbilities: savingThrows(cls).slice(0, 2),
				subclassLevel: subclassLevel(cls),
				abilityScoreIncreases: asiLevels(cls),
				...(isPooled ? {isPooledCaster: true} : {}),
			}),
		});

		// Saving throws
		for (const st of savingThrows(cls)) {
			recs.push({
				name: `${st} Saving Throw Proficiency`,
				parent: basicsName, level: "1", multiclass: "FALSE",
				payload: pay({type: "Proficiency", category: "Saving Throw", proficiency: st, proficiencyLevel: "Proficient"}),
			});
		}

		// Hit Dice
		recs.push({
			name: "Hit Dice",
			parent: basicsName, level: "every", multiclass: "FALSE",
			payload: pay({type: "Hit Dice", dieSize: cls.hd?.faces ?? 8, dieCount: 1, recovery: "Long Rest"}),
		});

		// Armor proficiencies
		for (const a of armorProfs(cls)) {
			recs.push({
				name: `${a} Proficiency`,
				parent: basicsName, level: "1",
				payload: pay({type: "Proficiency", category: "Armor", proficiency: a, proficiencyLevel: "Proficient"}),
			});
		}

		// Weapon proficiencies
		for (const w of weaponProfs(cls)) {
			recs.push({
				name: `${w} Proficiency`,
				parent: basicsName, level: "1",
				payload: pay({type: "Proficiency", category: "Weapon", proficiency: w, proficiencyLevel: "Proficient"}),
			});
		}

		// Skill proficiency choice
		const rawSkills = cls.startingProficiencies?.skills;
		const skillsObj = Array.isArray(rawSkills) ? rawSkills[0] : rawSkills;
		if (skillsObj?.choose) {
			recs.push({
				name: `${n} Skill Proficiency`,
				parent: basicsName, level: "1", multiclass: "FALSE",
				payload: pay({
					type: "Proficiency Choice",
					subtype: "Skill",
					proficiencyLevel: "Proficient",
					list: skillsObj.choose.from || [],
					numOfChoices: skillsObj.choose.count || 2,
					increaseIfAlreadyAt: false,
				}),
			});
		}

		// Starting equipment choices (gold OR specific items)
		recs.push(...buildEquipRecords(cls, basicsName));

		// Class features per level
		let scAdded = false;

		for (let lvl = 1; lvl <= 20; lvl++) {
			const feats = cls.classFeatures?.[lvl - 1];
			if (!Array.isArray(feats)) continue;

			for (const feat of feats) {
				if (!feat?.name) continue;
				if (feat.gainSubclassFeature) continue;

				const desc = renderDesc(feat.entries);

				if (feat.name === "Ability Score Improvement") {
					recs.push({
						name: `Ability Score Improvement (${lvl})`, level: String(lvl),
						payload: pay({type: "Builder-Exclusive Feature", name: "Ability Score Improvement",
							description: "Your ability scores each increase by 1, or one ability score increases by 2."}),
					});
					continue;
				}

				// Spellcasting feature — add config + spell slot children
				if (feat.name === "Spellcasting" && spellAbility && casterType && !scAdded) {
					scAdded = true;
					const scParent = `${n} Spellcasting`;
					recs.push({name: scParent, level: String(lvl),
						payload: pay({type: "Features", name: feat.name, description: desc})});

					recs.push({
						name: `${n} ${spellAbility} Spellcasting`,
						parent: scParent, level: String(lvl),
						payload: pay({type: "Spellcasting", ability: spellAbility, casterType, name: n}),
					});

					if (spellTable) {
						recs.push(...spellSlotRecords(n, scParent, spellTable, isPact));
					}

					// Initial spell choices for known-casters
					if (!isPooled) {
						recs.push({
							name: `${n} Level 1 Spells`, parent: scParent, level: String(lvl),
							builderDisplayName: `${n} Starting Spells`,
							payload: pay({type: "Spell Choice", spellLevel: 1, includeBelow: true, choices: 2,
								fromClassList: [n], filter: [], list: [], replace: false}),
						});
					}
					continue;
				}

				recs.push({name: feat.name, level: String(lvl),
					payload: pay({type: "Features", name: feat.name, description: desc})});
			}
		}

		return recs;
	}

	// ── Build data-datarecords for a race ─────────────────────────────────────

	function buildRaceRecords (race) {
		const recs = [];
		const n = race.name;
		const sizeAbv  = (race.size || ["M"])[0];
		const sizeName = SIZE_MAP[sizeAbv] || "Medium";
		const walkSpd  = typeof race.speed === "number" ? race.speed : (race.speed?.walk || 30);
		const otherSpd = Object.keys(race.speed).length > 0 ? race.speed : null;
		const dv       = race.darkvision || 0;

		// Ability score increases
		const abilityEntry = (race.ability || [])[0] || {};
		const staticASIs = Object.entries(abilityEntry).filter(([k]) => k !== "choose");
		if (staticASIs.length) {
			const asiParent = `${n} Ability Score Increase`;
			recs.push({
				name: asiParent,
				builderDisplayName: "Ability Score Increase",
				payload: pay({
					type: "Builder-Exclusive Feature",
					name: "Ability Score Increase",
					description: staticASIs.map(([k, v]) => `Your ${ABV[k] || k} score increases by ${v}.`).join(" "),
				}),
			});
			for (const [abv, val] of staticASIs) {
				recs.push({
					name: `${ABV[abv] || abv} Score Bonus`, parent: asiParent, level: "1",
					payload: pay({type: "Ability Score", ability: ABV[abv] || abv, calculation: "Modify", valueFormula: {flatValue: val}}),
				});
			}
		}

		// Size
		recs.push({
			name: `${n} Size`, level: "1", builderDisplayName: `${sizeName} Size`,
			payload: pay({type: "Features", name: "Size", description: `Your size is ${sizeName}.`}),
		});
		recs.push({
			name: `${sizeName} Size`, parent: `${n} Size`, level: "1",
			payload: pay({type: "Size", sizeValue: sizeName}),
		});

		// Speed
		recs.push({
			name: `${n} Speed`, level: "1", builderDisplayName: `${walkSpd} Speed`,
			payload: pay({type: "Features", name: "Speed", description: `Your base walking speed is ${walkSpd} feet.`}),
		});
		recs.push({
			name: "Walk Speed Base", parent: `${n} Speed`, level: "1",
			payload: pay({type: "Speed", speed: "Walk", calculation: "Set Base", valueFormula: {flatValue: walkSpd}}),
		});
		if (otherSpd != null)
			for (spd in otherSpd) {
				if (spd == "walk")
					continue;
				
				const spdName = spd.toTitleCase();
				let spdNum = otherSpd[spd];
				
				if (spdNum === true)
					spdNum = walkSpd;

				recs.push({
					name: `${spdNum} ${spdName} Speed Base`, parent: `${n} Speed`, level: "1",
					payload: pay({type: "Speed", speed: spdName, calculation: "Set Base", valueFormula: {flatValue: spdNum}}),
				});
			}

		// Darkvision
		if (dv) {
			recs.push({
				name: `${n} Darkvision`, level: "1", builderDisplayName: "Darkvision",
				payload: pay({type: "Features", name: "Darkvision",
					description: `You can see in dim light within ${dv} feet as if it were bright light, and in darkness as if it were dim light.`}),
			});
			recs.push({
				name: "Darkvision", parent: `${n} Darkvision`, level: "1",
				payload: pay({type: "Sense", name: "Darkvision", calculation: "Set Base", valueFormula: {flatValue: dv}}),
			});
		}

		recs.push(...defenseRecords("Resistance", race.resist));
		recs.push(...defenseRecords("Vulnerability", race.vulnerable));
		recs.push(...defenseRecords("Immunity", race.immune));
			

		// Feature entries
		for (const entry of (race.entries || [])) {
			if (!entry?.name) continue;
			const desc = renderDesc(entry.entries);
			recs.push({name: entry.name, level: "1",
				payload: pay({type: "Features", name: entry.name, description: desc})});
		}

		// Language proficiencies
		const langProfs = (race.languageProficiencies || [])[0] || {};
		const fixedLangs = Object.entries(langProfs)
			.filter(([k, v]) => v === true && !k.startsWith("any"))
			.map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
		const anyLangs = langProfs.anyStandard || langProfs.any || 0;

		if (fixedLangs.length || anyLangs) {
			const langParent = `${n} Languages`;
			recs.push({
				name: langParent, level: "1", builderDisplayName: "Language Proficiencies",
				payload: pay({type: "Features", name: "Languages",
					description: `You can speak, read, and write ${fixedLangs.join(", ")}${anyLangs ? ` and ${anyLangs} language${anyLangs > 1 ? "s" : ""} of your choice` : ""}.`}),
			});
			for (const lang of fixedLangs) {
				recs.push({name: `${lang} Proficiency`, parent: langParent, level: "1",
					payload: pay({type: "Language", name: lang})});
			}
			if (anyLangs) {
				recs.push({name: `${n} Language Choice`, parent: langParent, level: "1",
					payload: pay({type: "Language Choice", numOfChoices: anyLangs, list: STD_LANGUAGES})});
			}
		}

		return recs;
	}

	// ── Build data-datarecords for a background ───────────────────────────────

	// Keys that map to a list choice (not a fixed proficiency)
	const BG_TOOL_LIST = {
		anyGamingSet:        "Lists:Gaming Sets Proficiency",
		anyMusicalInstrument:"Lists:Musical Instruments Proficiency",
		anyArtisansTool:     "Lists:Artisan's Tools Proficiency",
	};
	// Keys that map to a fixed tool name
	const BG_TOOL_NAME = {
		thievesTools:         "Thieves' Tools",
		disguiseKit:          "Disguise Kit",
		forgeryKit:           "Forgery Kit",
		herbalismKit:         "Herbalism Kit",
		navigatorSTools:      "Navigator's Tools",
		poisonersKit:         "Poisoner's Kit",
		waterVehicles:        "Water Vehicles",
		landVehicles:         "Land Vehicles",
		"thieves' tools":     "Thieves' Tools",
		"disguise kit":       "Disguise Kit",
		"forgery kit":        "Forgery Kit",
		"herbalism kit":      "Herbalism Kit",
		"navigator's tools":  "Navigator's Tools",
		"water vehicles":     "Water Vehicles",
		"land vehicles":      "Land Vehicles",
	};

	const BG_GOLD = {
		Noble: 25, Knight: 25, Hermit: 5, Outlander: 10,
		"Folk Hero": 10, Sage: 10, Soldier: 10, Sailor: 10, Pirate: 10,
	};

	function bgTableRows (table) {
		return (table.rows || []).map(r => Array.isArray(r) ? r[r.length - 1] : "").filter(Boolean);
	}

	// Extract personality tables and specialty tables from a background's entries
	function extractBgTables (bg) {
		const result = {traits: [], ideals: [], bonds: [], flaws: [], specialty: [], specialtyName: null};
		for (const section of (bg.entries || [])) {
			if (!section || typeof section !== "object") continue;
			const isSugChar = /suggested characteristics/i.test(section.name || "");
			for (const entry of (section.entries || [])) {
				if (!entry || entry.type !== "table") continue;
				const label = entry.colLabels && entry.colLabels[1];
				const rows  = bgTableRows(entry);
				if (isSugChar) {
					if (label === "Personality Trait") result.traits = rows;
					else if (label === "Ideal")        result.ideals  = rows;
					else if (label === "Bond")         result.bonds   = rows;
					else if (label === "Flaw")         result.flaws   = rows;
				} else if (rows.length) {
					result.specialty     = rows;
					result.specialtyName = section.name || label || "Specialty";
				}
			}
		}
		return result;
	}

	function buildBgRecords (bg) {
		const recs = [];
		const n = bg.name;

		// Top-level background record
		const bgDesc = (bg.entries || []).filter(e => typeof e === "string").join(" ").trim();
		recs.push({name: n, level: "1",
			payload: pay({type: "Background", name: n, description: bgDesc})});

		// Skill proficiencies
		const skillProfs = (bg.skillProficiencies || [])[0] || {};
		for (const [skill, val] of Object.entries(skillProfs)) {
			if (!val || skill === "choose") continue;
			const skillName = skill.charAt(0).toUpperCase() + skill.slice(1).replace(/([A-Z])/g, " $1").trim();
			recs.push({
				name: `${skillName} Proficiency`, parent: n, level: "1",
				builderDisplayName: "Background Proficiencies",
				payload: pay({type: "Proficiency", category: "Skill", proficiency: skillName,
					proficiencyLevel: "Proficient", increaseIfAlreadyAt: false}),
			});
		}

		// Tool proficiencies — fixed tools and list-choice tools
		const toolProfs = (bg.toolProficiencies || [])[0] || {};
		for (const [tool, val] of Object.entries(toolProfs)) {
			if (!val || tool === "choose") continue;
			const listRef = BG_TOOL_LIST[tool];
			if (listRef) {
				const count = typeof val === "number" ? val : 1;
				recs.push({
					name: `${tool} Proficiency`, parent: n, level: "1",
					builderDisplayName: "Background Proficiencies",
					payload: pay({type: "Proficiency Choice", subtype: "Tool",
						proficiencyLevel: "Proficient", list: [listRef], numOfChoices: count,
						increaseIfAlreadyAt: false}),
				});
			} else {
				const toolName = BG_TOOL_NAME[tool] ||
					(tool.charAt(0).toUpperCase() + tool.slice(1).replace(/([A-Z])/g, " $1").trim());
				recs.push({
					name: `${toolName} Proficiency`, parent: n, level: "1",
					builderDisplayName: "Background Proficiencies",
					payload: pay({type: "Proficiency", category: "Tool", proficiency: toolName,
						proficiencyLevel: "Proficient", increaseIfAlreadyAt: false}),
				});
			}
		}

		// Language proficiency choice
		const langProfs = (bg.languageProficiencies || [])[0] || {};
		const anyLangs = langProfs.anyStandard || langProfs.any || 0;
		if (anyLangs) {
			recs.push({name: `Language Choice`, parent: n, level: "1",
				builderDisplayName: "Background Language Proficiency",
				payload: pay({type: "Language Choice", numOfChoices: anyLangs, list: STD_LANGUAGES})});
		}

		// Starting equipment — use a choice container (matches PHB format) so the equipment
		// section renders correctly.  Currency is placed OUTSIDE the container so it is
		// applied automatically as a fixed grant, not shown as an alternative option.
		const eqFixed = [];
		for (const group of (bg.startingEquipment || [])) {
			for (const raw of (group._ || [])) {
				const name = typeof raw === "string" ? cleanItem(raw) :
					raw.displayName ? (raw.displayName.charAt(0).toUpperCase() + raw.displayName.slice(1)) :
					raw.item ? cleanItem(raw.item) : null;
				if (name) eqFixed.push(name);
			}
		}

		const gold = BG_GOLD[n] ?? 15;
		const eqChoiceName = `${n} Equipment Choice`;
		recs.push({name: eqChoiceName, parent: n, level: "1",
			builderDisplayName: "Equipment",
			payload: pay({type: "Starting Equipment", subtype: "choice", items: [], numOfChoices: 1})});

		if (eqFixed.length) {
			recs.push({name: `${n} Equipment`, parent: eqChoiceName, level: "1",
				payload: pay({type: "Starting Equipment", subtype: "fixed", items: eqFixed})});
		}

		// Note: Starting Currency is intentionally omitted — it appears as a confusing selectable
		// item in the Charactermancer picker. Players can add starting gold manually.

		// Entry sections (Features + specialty tables), skip Suggested Characteristics
		for (const section of (bg.entries || [])) {
			if (!section?.name || section.type === "list") continue;
			if (/suggested characteristics/i.test(section.name)) continue;

			// Check for a specialty table inside this section
			const specialtyTable = (section.entries || []).find(e => e?.type === "table");

			// Feature description (skip pure-string paragraphs already in bgDesc)
			const featDesc = renderDesc(section.entries);
			recs.push({name: section.name, parent: n, level: "1",
				payload: pay({type: "Features", name: section.name, description: featDesc})});

			if (specialtyTable) {
				const colLabel = specialtyTable.colLabels && specialtyTable.colLabels[1];
				const options  = bgTableRows(specialtyTable);
				if (options.length) {
					recs.push({
						name: `${section.name} Table`, parent: section.name, level: "1",
						payload: pay({type: "Personality Trait Choice",
							name: colLabel || "Specialty", numOfChoices: 1, options}),
					});
				}
			}
		}

		// Suggested Characteristics section — Personality Traits, Ideals, Bonds, Flaws
		const sugChar = (bg.entries || []).find(e => e?.name && /suggested characteristics/i.test(e.name));
		if (sugChar) {
			const sugDesc = (sugChar.entries || []).filter(e => typeof e === "string").join(" ").trim();
			const sugName = `${n} Suggested Characteristics`;
			recs.push({name: sugName, parent: n, level: "1",
				payload: pay({type: "Features", name: `${n} Suggested Characteristics`, description: sugDesc})});

			const labelMap = {
				"Personality Trait": {payloadName: "Personality Traits", choices: 2},
				"Ideal": {payloadName: "Ideals", choices: 1},
				"Bond":  {payloadName: "Bonds",  choices: 1},
				"Flaw":  {payloadName: "Flaws",  choices: 1},
			};
			for (const entry of (sugChar.entries || [])) {
				if (!entry || entry.type !== "table") continue;
				const rawLabel = entry.colLabels && entry.colLabels[1];
				const spec     = labelMap[rawLabel];
				if (!spec) continue;
				const options  = bgTableRows(entry);
				if (options.length) {
					recs.push({
						name: `${n} ${spec.payloadName}`, parent: sugName, level: "1",
						payload: pay({type: "Personality Trait Choice",
							name: spec.payloadName, numOfChoices: spec.choices, options}),
					});
				}
			}
		}

		// 2024 (XPHB) ability score options
		if (bg.ability) {
			const abiDesc = bg.ability.map(ab => {
				if (ab.choose?.weighted) {
					const w   = ab.choose.weighted;
					const max = Math.max(...(w.weights || [2]));
					const pool = (w.from || []).map(a => ABV[a] || a).join("/");
					return `+${max} to one ${pool}, +1 to another ${pool}`;
				}
				return Object.entries(ab).filter(([k]) => k !== "choose")
					.map(([k, v]) => `+${v} ${ABV[k] || k}`).join(", ");
			}).join("; or ");
			recs.push({name: `${n} Ability Score Increase`, parent: n, level: "1",
				payload: pay({type: "Features", name: "Ability Score Increase", description: abiDesc})});
		}

		// 2024 (XPHB) origin feat
		if (bg.feats) {
			for (const featGroup of bg.feats) {
				for (const featKey of Object.keys(featGroup)) {
					if (!featKey || featKey === "choose") continue;
					const featDisplay = featKey.split("|")[0].replace(/;/g, ":").replace(/\b\w/g, c => c.toUpperCase()).trim();
					recs.push({
						name: `${n} Origin Feat`, parent: n, level: "1",
						builderDisplayName: `Origin Feat: ${featDisplay}`,
						payload: pay({type: "Features", name: `Origin Feat: ${featDisplay}`,
							description: `This background grants the ${featDisplay} feat.`}),
					});
				}
			}
		}

		return recs;
	}

	// ── Charactermancer entry builders ────────────────────────────────────────

	function classEntry (cls) {
		const sts = savingThrows(cls);
		const spellAbility = cls.spellcastingAbility ? ABV[cls.spellcastingAbility] : null;
		const casterType   = spellAbility ? (CASTER_MAP[cls.casterProgression] || "full") : null;
		const entry = {
			id: makeId(`class:${cls.name}:${cls.source}`),
			name: cls._displayName || cls.name,
			properties: {
				"Category": "Classes",
				"Hit Die": `d${cls.hd?.faces ?? 8}`,
				"data-List": "false",
				"data-builderImage": CLASS_IMG[cls.name] || GENERIC_CLASS_IMG,
				"data-datarecords": JSON.stringify(buildClassRecords(cls)),
				"data-Saving Throws": JSON.stringify(sts),
				"data-Subclass Level": subclassLevel(cls),
				"data-Ability Score Levels": JSON.stringify(asiLevels(cls)),
				...(spellAbility ? {"Caster Progression": casterType, "Spellcasting Ability": spellAbility} : {}),
			},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(cls.source),
		};
		_pageCache.set(entry.id, entry);
		return entry;
	}

	function raceEntry (race) {
		const sizeAbv  = (race.size || ["M"])[0];
		const sizeName = SIZE_MAP[sizeAbv] || "Medium";
		const walkSpd  = typeof race.speed === "number" ? race.speed : (race.speed?.walk || 30);
		const entry = {
			id: makeId(`race:${race.name}:${race.source}`),
			name: race._displayName || race.name,
			properties: {
				"Category": "Races",
				"Size": sizeName,
				"Speed": walkSpd,
				"data-List": "false",
				"data-builderImage": RACE_IMG[race.name] || GENERIC_SPECIES_IMG,
				"data-datarecords": JSON.stringify(buildRaceRecords(race)),
			},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(race.source),
		};
		_pageCache.set(entry.id, entry);
		return entry;
	}

	function bgEntry (bg) {
		const tables = extractBgTables(bg);
		const gold   = BG_GOLD[bg.name] ?? 15;
		const entry  = {
			id: makeId(`bg:${bg.name}:${bg.source}`),
			name: bg._displayName || bg.name,
			properties: {
				"Category": "Backgrounds",
				"data-List": "false",
				"filter-Feat": "No",
				"data-datarecords": JSON.stringify(buildBgRecords(bg)),
				"data-Starting Gold": gold,
				...(tables.traits.length  ? {"data-Personality Traits": JSON.stringify(tables.traits)} : {}),
				...(tables.bonds.length   ? {"data-Bonds":              JSON.stringify(tables.bonds)}  : {}),
				...(tables.flaws.length   ? {"data-Flaws":              JSON.stringify(tables.flaws)}  : {}),
				...(tables.ideals.length  ? {"data-Ideals":             JSON.stringify(tables.ideals)} : {}),
				...(tables.specialty.length ? {
					"data-Background Choices":    JSON.stringify(tables.specialty),
					"data-Background Choice Name": tables.specialtyName,
				} : {}),
			},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(bg.source),
		};
		_pageCache.set(entry.id, entry);
		return entry;
	}

	// ── Feat helpers ──────────────────────────────────────────────────────────

	function prereqToString (prereqs) {
		if (!prereqs) return "";
		const parts = [];
		for (const p of prereqs) {
			const lvl = p.level;
			if (lvl != null) parts.push(`Level ${typeof lvl === "object" ? lvl.level : lvl}`);
			if (p.ability) p.ability.forEach(ab => Object.entries(ab).forEach(([k, v]) => parts.push(`${ABV[k] || k} ${v}+`)));
			if (p.spellcasting) parts.push("Spellcasting");
			if (p.feature) parts.push(typeof p.feature === "string" ? p.feature : p.feature.name || "Feature");
			if (p.proficiency) p.proficiency.forEach(pr => parts.push(Object.values(pr)[0] + " proficiency"));
			if (p.other) parts.push(p.other);
		}
		return parts.join(", ");
	}

	function buildFeatRecords (feat) {
		const recs = [];
		const desc = renderDesc(feat.entries);
		recs.push({
			name: feat.name,
			level: "1",
			payload: pay({type: "Features", name: feat.name, description: desc}),
		});

		// Ability score grants
		for (const ab of (feat.ability || [])) {
			if (ab.hidden) continue;
			for (const [k, v] of Object.entries(ab)) {
				if (k === "choose" || k === "hidden") continue;
				if (typeof v === "number") {
					recs.push({
						name: `${ABV[k] || k} Score Bonus`, parent: feat.name, level: "1",
						payload: pay({type: "Ability Score", ability: ABV[k] || k, calculation: "Modify", valueFormula: {flatValue: v}}),
					});
				}
			}
			if (ab.choose) {
				const from = (ab.choose.from || []).map(a => ABV[a] || a);
				const amount = ab.choose.amount || 1;
				const count  = ab.choose.count  || 1;
				if (from.length) {
					recs.push({
						name: `${feat.name} Ability Score`, parent: feat.name, level: "1",
						payload: pay({type: "Proficiency Choice", subtype: "Ability Score",
							list: from, numOfChoices: count, proficiencyLevel: amount}),
					});
				}
			}
		}

		// Skill proficiencies
		for (const grp of (feat.skillProficiencies || [])) {
			for (const [skill, val] of Object.entries(grp)) {
				if (!val || skill === "choose") continue;
				const name = skill.charAt(0).toUpperCase() + skill.slice(1).replace(/([A-Z])/g, " $1");
				recs.push({
					name: `${name} Proficiency`, parent: feat.name, level: "1",
					payload: pay({type: "Proficiency", category: "Skill", proficiency: name, proficiencyLevel: "Proficient"}),
				});
			}
		}

		return recs;
	}

	function featEntry (feat) {
		const prereq = prereqToString(feat.prerequisite);
		const entry = {
			id: makeId(`feat:${feat.name}:${feat.source}`),
			name: feat._displayName || feat.name,
			properties: {
				"Category": "Feats",
				"data-List": "false",
				"data-builderImage": "",
				"data-datarecords": JSON.stringify(buildFeatRecords(feat)),
				...(prereq ? {"Prerequisite": prereq} : {}),
			},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(feat.source),
		};
		_pageCache.set(entry.id, entry);
		return entry;
	}

	// ── Subclass helpers ──────────────────────────────────────────────────────

	function buildSubclassRecords (subcls) {
		const recs = [];
		// _features are the resolved subclassFeature objects joined in getSubclasses()
		for (const feat of (subcls._features || [])) {
			if (!feat?.name) continue;
			if (/subclass feature/i.test(feat.name)) continue;
			if (feat.name === subcls.name) continue; // skip intro entry that shares the subclass name
			const desc = renderDesc(feat.entries);
			recs.push({
				name: feat.name,
				level: String(feat.level || 1),
				payload: pay({type: "Features", name: feat.name, description: desc}),
			});
		}
		return recs;
	}

	function subclassEntry (subcls, className) {
		const entry = {
			id: makeId(`subclass:${subcls.name}:${subcls.source}`),
			name: subcls._displayName || subcls.name,
			properties: {
				"Category": "Subclasses",
				"Class": className,
				"Parent Class": className,
				"data-List": "false",
				"data-builderImage": "",
				"data-datarecords": JSON.stringify(buildSubclassRecords(subcls)),
			},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(subcls.source),
		};
		_pageCache.set(entry.id, entry);
		return entry;
	}

	// ── Subrace helpers ───────────────────────────────────────────────────────

	function buildSubraceRecords (subrace) {
		const recs = [];

		// Expanded _versions entries (e.g. Dragonborn draconic ancestries from PHB)
		if (subrace._expandedVars) {
			const vars    = subrace._expandedVars;
			const resist  = subrace._expandedResist || [];
			const dmgRaw  = vars.damageType || "";
			const dmgType = dmgRaw.charAt(0).toUpperCase() + dmgRaw.slice(1);
			const area    = vars.area || "15-foot cone";
			const saveAbil = vars.savingThrow || "Dexterity";

			recs.push({name: "Draconic Ancestry", level: "1",
				payload: pay({type: "Features", name: "Draconic Ancestry",
					description: `Your draconic ancestry is ${vars.color || subrace.name}. Your damage type is ${dmgType}, and your breath weapon covers a ${area}.`})});
			recs.push({name: "Breath Weapon", level: "1",
				payload: pay({type: "Features", name: "Breath Weapon",
					description: `You can use your action to exhale ${dmgType.toLowerCase()} energy in a ${area}. Each creature must make a ${saveAbil} saving throw (DC 8 + Con modifier + proficiency bonus). A creature takes 2d6 damage on a failed save, or half on a success. Damage increases to 3d6 at 6th, 4d6 at 11th, 5d6 at 16th level.`})});
			for (const r of resist) {
				const rt = r.charAt(0).toUpperCase() + r.slice(1);
				recs.push({name: `${rt} Resistance`, level: "1",
					payload: pay({type: "Defense", defense: "Resistance", damage: rt})});
			}
			return recs;
		}

		const n = subrace.name;

		// Ability score bonuses
		const abilityEntry = (subrace.ability || [])[0] || {};
		const staticASIs = Object.entries(abilityEntry).filter(([k]) => k !== "choose");
		if (staticASIs.length) {
			const asiParent = `${n} Ability Score Increase`;
			recs.push({
				name: asiParent,
				payload: pay({
					type: "Builder-Exclusive Feature",
					name: "Ability Score Increase",
					description: staticASIs.map(([k, v]) => `Your ${ABV[k] || k} score increases by ${v}.`).join(" "),
				}),
			});
			for (const [abv, val] of staticASIs) {
				recs.push({
					name: `${ABV[abv] || abv} Score Bonus`, parent: asiParent, level: "1",
					payload: pay({type: "Ability Score", ability: ABV[abv] || abv, calculation: "Modify", valueFormula: {flatValue: val}}),
				});
			}
		}

		// Feature entries
		for (const entry of (subrace.entries || [])) {
			if (!entry?.name) continue;
			const desc = renderDesc(entry.entries);
			recs.push({name: entry.name, level: "1",
				payload: pay({type: "Features", name: entry.name, description: desc})});
		}

		// Language proficiencies
		const langProfs = (subrace.languageProficiencies || [])[0] || {};
		const fixedLangs = Object.entries(langProfs)
			.filter(([k, v]) => v === true && !k.startsWith("any"))
			.map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
		const anyLangs = langProfs.anyStandard || langProfs.any || 0;
		if (fixedLangs.length || anyLangs) {
			const langParent = `${n} Languages`;
			recs.push({name: langParent, level: "1",
				payload: pay({type: "Features", name: "Languages",
					description: `You can speak${fixedLangs.length ? `, read, and write ${fixedLangs.join(", ")}` : ""}${anyLangs ? ` and ${anyLangs} additional language${anyLangs > 1 ? "s" : ""} of your choice` : ""}.`})});
			for (const lang of fixedLangs) {
				recs.push({name: `${lang} Proficiency`, parent: langParent, level: "1",
					payload: pay({type: "Language", name: lang})});
			}
			if (anyLangs) {
				recs.push({name: `${n} Language Choice`, parent: langParent, level: "1",
					payload: pay({type: "Language Choice", numOfChoices: anyLangs, list: STD_LANGUAGES})});
			}
		}

		// Darkvision override
		if (subrace.darkvision) {
			recs.push({
				name: "Darkvision", level: "1",
				payload: pay({type: "Sense", name: "Darkvision", calculation: "Set Base", valueFormula: {flatValue: subrace.darkvision}}),
			});
		}

		return recs;
	}

	function subraceEntry (subrace, parentRaceName) {
		const entry = {
			id: makeId(`subrace:${subrace.name}:${subrace.raceName}:${subrace.source}`),
			name: subrace._displayName || subrace.name,
			properties: {
				"Category": "Subraces",
				"Race": parentRaceName,
				"Parent Race": parentRaceName,
				"data-List": "false",
				"data-builderImage": "",
				"data-datarecords": JSON.stringify(buildSubraceRecords(subrace)),
			},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(subrace.source),
		};
		_pageCache.set(entry.id, entry);
		return entry;
	}

	// Extract the target name from a Subclasses or Subraces category query.
	// Roll20 hex-encodes the first letter in the regex filter:
	//   JSON body contains (.*?)\\\\x57izard(.*?)  (4 raw backslashes before xNN)
	function extractSubclassTargetClass (body) {
		const m = body.match(/\(\.\*\?\)(.*?)\(\.\*\?\)/);
		if (!m) return null;
		let raw = m[1];
		// Replace any run of backslashes + xNN with the decoded character
		raw = raw.replace(/\\+x([0-9a-fA-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
		raw = raw.replace(/\\/g, ""); // strip any leftover backslashes
		// Strip source label appended by our inject deduplication (e.g. "Barbarian (PHB)" → "Barbarian")
		raw = raw.replace(/\s+\([A-Z][A-Za-z0-9]+\)$/, "");
		return raw.trim() || null;
	}

	// ── Weapon item builders ─────────────────────────────────────────────────

	function formatGp (cp) {
		if (!cp) return "";
		if (cp % 100 === 0) return `${cp / 100} GP`;
		if (cp % 10  === 0) return `${cp / 10} SP`;
		return `${cp} CP`;
	}

	function buildWeaponRecords (item) {
		const recs  = [];
		const n     = item.name;
		const props = (item.property || []).map(p => ITEM_PROP[p]).filter(Boolean);
		const dmgT  = ITEM_DMG[item.dmgType] || "Bludgeoning";
		const dmg1  = item.dmg1 || "1d4";
		const dmg2  = item.dmg2 || dmg1;
		const die1  = dmg1.replace(/^\d+/, "");          // "1d6" → "d6", "2d6" → "d6"
		const cnt1  = parseInt(dmg1) || 1;               // "2d6" → 2
		const die2  = dmg2.replace(/^\d+/, "");
		const cnt2  = parseInt(dmg2) || 1;
		const isM   = item.type === "M";
		const isFin = (item.property||[]).includes("F");
		const isLt  = (item.property||[]).includes("L");
		const isThr = (item.property||[]).includes("T");
		const isVer = (item.property||[]).includes("V");
		const range = item.range ? `${item.range} ft` : null;
		const training = item.weaponCategory === "simple" ? "Simple" : "Martial";
		const cat = isM ? "Melee" : "Ranged";

		const itmPay = pay({type:"Item", name:n, weight: item.weight||"",
			properties: props, cost: formatGp(item.value||0),
			weaponData:{category:cat, training, type:n}, equipData:{equippable:true}});
		recs.push({name:n, payload:itmPay});

		const atkPay = (atkName, type, ability, atkRange) => pay({
			type:"Attack", name:atkName,
			...(atkRange ? {range:atkRange} : {}),
			attack:{type, abilityBonus:ability},
		});
		const dmgPay = (ability, dieSize, dieCount, bonus) => pay({
			type:"Damage", ability,
			...(dieCount > 1 ? {diceCount} : {}),
			...(bonus ? {bonus} : {}),
			damageType:dmgT, diceSize:dieSize,
		});

		if (isM) {
			if (isVer) {
				const a1 = `${n} Attack One-Handed`;
				recs.push({name:a1, parent:n, payload:atkPay(`${n} (One Handed)`,"Melee","Strength")});
				recs.push({name:`${n} Damage 1`, parent:a1, payload:dmgPay("auto",die1,cnt1)});
				const a2 = `${n} Attack Two-Handed`;
				recs.push({name:a2, parent:n, payload:atkPay(`${n} (Two Handed)`,"Melee","Strength")});
				recs.push({name:`${n} Damage 2`, parent:a2, payload:dmgPay("auto",die2,cnt2)});
			} else if (isFin) {
				const aStr = `${n} STR Attack`;
				recs.push({name:aStr, parent:n, payload:atkPay(n,"Melee","Strength")});
				recs.push({name:`${n} STR Damage`, parent:aStr, payload:dmgPay("auto",die1,cnt1)});
				const aDex = `${n} DEX Attack`;
				recs.push({name:aDex, parent:n, payload:atkPay(`${n} (Finesse)`,"Melee","Dexterity")});
				recs.push({name:`${n} DEX Damage`, parent:aDex, payload:dmgPay("auto",die1,cnt1)});
			} else {
				const atk = `${n} Attack`;
				recs.push({name:atk, parent:n, payload:atkPay(n,"Melee","Strength")});
				recs.push({name:`${n} Damage`, parent:atk, payload:dmgPay("auto",die1,cnt1)});
			}
			if (isLt) {
				const aOff = `${n} (Off-hand) Attack`;
				recs.push({name:aOff, parent:n, payload:atkPay(`${n} (Off-hand)`,"Melee","Strength")});
				recs.push({name:`${n} (Off-hand) Damage`, parent:aOff,
					payload:dmgPay("none",die1,cnt1,"min(@{strength_mod},0)")});
			}
			if (isThr && range) {
				const aThr = `Throw ${n}`;
				recs.push({name:aThr, parent:n,
					payload:atkPay(`Throw ${n}`,"Ranged",isFin?"Dexterity":"Strength",range)});
				recs.push({name:`Thrown ${n} Damage`, parent:aThr, payload:dmgPay("auto",die1,cnt1)});
			}
		} else {
			const atk = `${n} Attack`;
			recs.push({name:atk, parent:n, payload:atkPay(n,"Ranged","Dexterity",range)});
			recs.push({name:`${n} Damage`, parent:atk, payload:dmgPay("auto",die1,cnt1)});
		}
		return recs;
	}

	function buildWeaponEntry (item) {
		const isM    = item.type === "M";
		const props  = (item.property||[]).map(p => ITEM_PROP[p]).filter(Boolean).join(", ");
		const dmgT   = ITEM_DMG[item.dmgType] || "Bludgeoning";
		const sub    = item.weaponCategory || "simple";
		const iType  = isM ? "Melee Weapon" : "Ranged Weapon";
		const fLists = ["Weapon", sub==="simple"?"Simple Weapon":"Martial Weapon", iType].join(", ");
		const id     = makeId(`item:${item.name}:${item.source}`);
		const baseProps = {
			"Category": "Items",
			"Damage": item.dmg1 || "1d4",
			...(item.weight ? {Weight: item.weight} : {}),
			"Subtype": sub,
			"Item Type": iType,
			"data-List": "false",
			...(props ? {Properties: props} : {}),
			"Damage Type": dmgT,
			"Item Rarity": "None",
			"filter-Lists": fLists,
			"filter-Damage": dmgT,
			"filter-Charges": "No",
			"filter-Attunement": "No",
			"filter-Consumable": "No",
			"Name": item.name,
			"data-RarityNum": 0,
		};
		// filterAndSortPages gets a single Item record (no Attack/Damage children) so the Charactermancer
		// can display the choice option without crashing on parent: field lookups.
		// The full entry (with attack/damage integrant records) lives in _pageCache for page(id:...).
		const displayRecs = [{
			name: item.name,
			payload: pay({type: "Item", name: item.name, weight: item.weight || "", cost: formatGp(item.value || 0)}),
		}];
		_pageCache.set(id, {
			id, name: item.name,
			properties: {...baseProps, "data-datarecords": JSON.stringify(buildWeaponRecords(item))},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(item.source),
		});
		return {
			id, name: item.name,
			properties: {...baseProps, "data-datarecords": JSON.stringify(displayRecs)},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(item.source),
		};
	}

	// ── Pack builders ────────────────────────────────────────────────────────

	// gearData is the pre-loaded allGear array (passed from the async Items handler)
	// queriedName is the exact string the Charactermancer used to look this up (may differ in case)
	function buildPackEntry (item, gearData, queriedName) {
		const packItems = (item.packContents || []).map(packItemToNameQty).filter(Boolean);
		const cost      = formatGp(item.value || 0);
		const entryName = queriedName || item.name;
		const id        = makeId(`item:${item.name}:${item.source}`);

		// Build full records (used in page(id:...) response post-selection).
		// These must NOT be in the filterAndSortPages response: the Charactermancer processes
		// data-datarecords from that query for display purposes and crashes on parent: fields,
		// also auto-applying the first option before the user sees the choice.
		const fullRecs = [{
			name: entryName,
			payload: pay({type: "Item", name: entryName, weight: item.weight || "", cost}),
		}];
		for (const {name: cName, qty} of packItems) {
			const g = (gearData || []).find(x => x.name.toLowerCase() === cName.toLowerCase());
			fullRecs.push({
				name: `${entryName} ${cName}`,
				parent: entryName,
				payload: pay({
					type: "Item", name: cName,
					...(qty > 1 ? {quantity: qty} : {}),
					weight: g?.weight || "",
					cost: formatGp(g?.value || 0) || "",
				}),
			});
		}

		const baseProps = {
			"Category": "Items",
			"Subtype": "Equipment Pack",
			"Item Type": "Adventuring Gear",
			"data-List": "false",
			"Item Rarity": "None",
			"filter-Lists": "Adventuring Gear, Equipment Pack",
			"filter-Charges": "No",
			"filter-Attunement": "No",
			"filter-Consumable": "Multiple Uses",
			"Name": item.name,
			"data-RarityNum": 0,
		};

		// Store full entry in _pageCache for page(id:...) queries (made post-selection).
		_pageCache.set(id, {
			id,
			name: item.name,
			properties: {...baseProps, "data-datarecords": JSON.stringify(fullRecs)},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(item.source),
		});

		// Return display entry for filterAndSortPages.
		// Use "adventuring-gear" subtype instead of "Equipment Pack" — the Charactermancer may
		// auto-apply "Equipment Pack" subtype items during choice display, bypassing the picker.
		// Single Item record (no parent: children) avoids the crash on parent: field lookups.
		// Use full records so pack contents are added to inventory when the pack is applied.
		// "adventuring-gear" subtype prevents the Charactermancer from auto-applying during display.
		const displayProps = {
			...baseProps,
			"Subtype": "adventuring-gear",
			"filter-Lists": "Adventuring Gear",
			"data-datarecords": JSON.stringify(fullRecs),
		};
		return {id, name: item.name, properties: displayProps, children: [], publisher: {name: "5etools", logoUrl: ""}, book: book(item.source)};
	}

	function buildGearEntry (item) {
		const cost = formatGp(item.value || 0);
		const desc = typeof (item.entries||[])[0] === "string" ? item.entries[0] : "";
		const id   = makeId(`gear:${item.name}:${item.source}`);
		const baseProps = {
			"Category": "Items",
			"Subtype": "adventuring-gear",
			"Item Type": "Adventuring Gear",
			"data-List": "false",
			...(item.weight ? {Weight: item.weight} : {}),
			"Item Rarity": "None",
			"filter-Lists": "Adventuring Gear",
			"filter-Charges": "No",
			"filter-Attunement": "No",
			"filter-Consumable": "No",
			"Name": item.name,
			"data-RarityNum": 0,
		};
		const recs = [{
			name: item.name,
			payload: pay({type: "Item", name: item.name, weight: item.weight || "", cost, description: desc}),
		}];
		_pageCache.set(id, {
			id, name: item.name,
			properties: {...baseProps, "data-datarecords": JSON.stringify(recs)},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(item.source),
		});
		return {
			id, name: item.name,
			properties: {...baseProps, "data-datarecords": JSON.stringify(recs)},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(item.source),
		};
	}

	// ── Fetch interceptor ─────────────────────────────────────────────────────

	const _origFetch = window.fetch;
	window.fetch = async function (...args) {
		const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
		if (!url || !url.includes(GRAPHQL_HOST)) return _origFetch.apply(this, args);

		const body = typeof (args[1] || {}).body === "string" ? args[1].body : "";

		// page(id:...) — return from cache immediately for our synthetic entries
		if (body.includes("page(id:")) {
			const idMatch = body.match(/page\(id:[^)]*?([a-f0-9]{24})/);
			
			if (idMatch) {
				const cached = _pageCache.get(idMatch[1]);
				if (cached) {
					return new Response(
						JSON.stringify({data: {ruleSystem: {page: cached}}, extensions: {}}),
						{status: 200, headers: {"Content-Type": "application/json"}},
					);
				}
			}
		}


		const isBooks      = body.includes("books {") || body.includes("books{");
		// Order matters: more-specific substring checks first
		const isSubraces   = body.includes("Subraces");
		const isSubclasses = body.includes("Subclasses");
		const isClasses    = !isSubclasses && body.includes("Classes");
		const isRaces      = !isSubraces && body.includes("Races");
		const isBgs        = body.includes("Backgrounds");
		const isFeats      = body.includes("Feats") && !isBgs;
		// Match Items/Lists — body contains \\\"Items\\\" so check for the literal word too
		const isItems      = body.includes("Items");
		const isLists      = !isItems && body.includes("Lists");

		if (!isBooks && !isClasses && !isSubclasses && !isSubraces && !isRaces && !isBgs && !isFeats && !isItems && !isLists) return _origFetch.apply(this, args);


		const response = await _origFetch.apply(this, args);
		let data;
		try { data = await response.json(); } catch (e) { return response; }

		try {
			// We only are adding on to the final page for now
			if (data?.extensions?.pageNumber < data?.extensions?.totalPages)
				return new Response(JSON.stringify(data), {status: 200, headers: {"Content-Type": "application/json"}});
			
			// Used for filtering out results that don't apply
			const filteredResults = (list, key, match, caseSensitive = true) => {
				let result
				
				if (!caseSensitive)
					match = match.toLowerCase()

				return list.filter( function (el) {
					// If the key is missing, just filter it out
					if (typeof el[key] != "string") {
						return false;
					}
					if (!caseSensitive)
						result = el[key].toLowerCase();
					else
						result = el[key];

					// Filter out if key result doesn't match
					return result.includes(match)
				})
			}

			if (isBooks) {
				const books = data?.data?.ruleSystem?.books;
				if (Array.isArray(books) && !books.find(b => b.itemId === "5")) {
					books.push(PHB_BOOK);
					d20plus.ut.log("[Charactermancer] Injected PHB into books response");
				}
			}

			const pages = data?.data?.ruleSystem?.category?.filterAndSortPages;
			if (Array.isArray(pages)) {
				// Deduplicate and label: when multiple entries share a name (e.g. PHB vs XPHB),
				// append "(SOURCE)" so players can tell them apart.
				const existing = new Set(pages.map(p => p.name.toLowerCase()));
				const inject = (all, toEntry) => {
					// Count how many times each name appears in our dataset
					const nameCounts = {};
					for (const x of all) { const k = x.name.toLowerCase(); nameCounts[k] = (nameCounts[k] || 0) + 1; }

					// Apply filters
					const filters = Array.from(body.matchAll(/[,{]v\s*:\s*\\"([^"\\]+)\\"/g)).map(m => m[1]);
					if (filters.length > 0) {
						const types = Array.from(body.matchAll(/[,{](?:field|k)\s*:\s*\\"([^"\\]+)\\"/g)).map(m => m[1]);

						// Apply general filters
						for (let i = 0; i < types.length; i++) {
							if (types[i] == "name")
								all = filteredResults(all, "name", filters[i], false);
						}
					}

					const results = [];
					for (const x of all) {
						const k = x.name.toLowerCase();
						const isDupe = nameCounts[k] > 1;
						// If Roll20 already returned this base name (owned book), skip all our
						// labeled versions — no need to add "(PHB)" when the user owns the PHB.
						if (isDupe && existing.has(k)) continue;
						// When names clash and Roll20 doesn't have it, show "(PHB)" / "(XPHB)" etc.
						const displayName = isDupe ? `${x.name} (${x.source})` : x.name;
						const checkKey   = displayName.toLowerCase();
						if (existing.has(checkKey)) continue;
						existing.add(checkKey);
						const item = isDupe ? Object.assign(Object.create(Object.getPrototypeOf(x)), x, {_displayName: displayName}) : x;
						try { const entry = toEntry(item); if (entry) results.push(entry); } catch (e) { /* skip */ }
					}
					return results;
				};

				if (isClasses) {
					const entries = inject(await getClasses(), classEntry);
					pages.push(...entries);
					d20plus.ut.log(`[Charactermancer] Injected ${entries.length} classes (${pages.length - entries.length} from server)`);
				}

				if (isSubclasses) {
					const className = extractSubclassTargetClass(body);
					if (className) {
						const allSubs = await getSubclasses();
						const toInject = allSubs.filter(s =>
							s.className?.toLowerCase() === className.toLowerCase() &&
							!existing.has(s.name.toLowerCase()),
						);
						for (const sub of toInject) {
							try { pages.push(subclassEntry(sub, className)); } catch (e) { /* skip */ }
						}
						d20plus.ut.log(`[Charactermancer] Injected ${toInject.length} subclasses for ${className} (${existing.size} from server)`);
					} else {
						d20plus.ut.log("[Charactermancer] Subclasses query — could not extract class name from body");
					}
				}

				if (isSubraces) {
					const raceName = extractSubclassTargetClass(body);
					if (raceName) {
						const allSubs = await getSubraces();
						// Deduplicate against server results AND against each other
						// (multiple sources can produce the same color name, e.g. PHB + XPHB Dragonborn)
						const seen = new Set(existing);
						const toInject = [];
						for (const s of allSubs) {
							if (s.raceName?.toLowerCase() !== raceName.toLowerCase()) continue;
							if (seen.has(s.name.toLowerCase())) continue;
							seen.add(s.name.toLowerCase());
							toInject.push(s);
						}
						for (const sub of toInject) {
							try { pages.push(subraceEntry(sub, raceName)); } catch (e) { /* skip */ }
						}
						d20plus.ut.log(`[Charactermancer] Injected ${toInject.length} subraces for ${raceName} (${existing.size} from server)`);
					} else {
						d20plus.ut.log("[Charactermancer] Subraces query — could not extract race name from body");
					}
				}

				if (isFeats) {
					const entries = inject(await getFeats(), featEntry);
					pages.push(...entries);
					d20plus.ut.log(`[Charactermancer] Injected ${entries.length} feats (${pages.length - entries.length} from server)`);
				}

				if (isRaces) {
					const entries = inject(await getRaces(), raceEntry);
					pages.push(...entries);
					d20plus.ut.log(`[Charactermancer] Injected ${entries.length} races/subraces (${pages.length - entries.length} from server)`);
				}
				if (isBgs) {
					const entries = inject(await getBackgrounds(), bgEntry);
					pages.push(...entries);
					d20plus.ut.log(`[Charactermancer] Injected ${entries.length} backgrounds (${pages.length - entries.length} from server)`);
				}

				if (isItems) {
					// Weapon list query (has Subtype filter) OR specific-name query
					const allWeapons = await getItems();
					const wantSimple  = body.includes("Subtype") && body.includes("simple");
					const wantMartial = body.includes("Subtype") && body.includes("martial");
						const wantMelee   = body.includes("Melee Weapon");
					const wantRanged  = body.includes("Ranged Weapon");

					if (wantSimple || wantMartial) {
						const toInject = allWeapons.filter(w => {
							if (existing.has(w.name.toLowerCase())) return false;
							if (wantSimple  && !wantMartial && w.weaponCategory !== "simple")  return false;
							if (wantMartial && !wantSimple  && w.weaponCategory !== "martial") return false;
							if (wantMelee   && !wantRanged  && w.type !== "M") return false;
							if (wantRanged  && !wantMelee   && w.type !== "R") return false;
							return true;
						});
						for (const w of toInject) {
							try { pages.push(buildWeaponEntry(w)); } catch (e) { /* skip */ }
						}
						d20plus.ut.log(`[Charactermancer] Injected ${toInject.length} weapon items`);
					} else {
						// Specific item name queries — GraphQL uses unquoted key: v:\"ItemName\"
						const nameMatches = Array.from(body.matchAll(/[,{]v\s*:\s*\\"([^"\\]+)\\"/g)).map(m => m[1]);
							const allPacks = await getPacks();
						const allGear  = await getGear();
						for (const name of nameMatches) {
							if (existing.has(name.toLowerCase())) continue;
							existing.add(name.toLowerCase());

							// Weapon check
							const w = allWeapons.find(x => x.name.toLowerCase() === name.toLowerCase());
							if (w) { try { pages.push(buildWeaponEntry(w)); } catch (e) { /* skip */ } continue; }

							// Pack — queriedName passed so entry.name matches exactly what was queried
							const p = allPacks.find(x => x.name.toLowerCase() === name.toLowerCase());
							if (p) {
								try { pages.push(buildPackEntry(p, allGear, name)); } catch (e) { /* skip */ }
								continue;
							}

							// Generic gear check
							const g = allGear.find(x => x.name.toLowerCase() === name.toLowerCase());
							if (g) { try { pages.push(buildGearEntry(g)); } catch (e) { /* skip */ } }
						}
					}
				}
			}

			// Lists: inject standard weapon list definitions (used by Charactermancer to build Items filter)
			// The GraphQL body uses unquoted keys so we match by checking if the list name literal appears.
			if (isLists) {
				const listPages = data?.data?.ruleSystem?.category?.filterAndSortPages;
				if (Array.isArray(listPages)) {
					const existing_lists = new Set(listPages.map(p => p.name));
					for (const [listName, filter] of Object.entries(STANDARD_LISTS)) {
						if (!body.includes(listName)) continue;
						if (existing_lists.has(listName)) continue;
						existing_lists.add(listName);
						listPages.push({
							id: makeId(`list:${listName}`),
							name: listName,
							properties: {
								"Category": "Lists",
								"data-filter": JSON.stringify(filter),
								"data-listCategory": "Items",
							},
							children: [],
							publisher: {name: "5etools", logoUrl: ""},
							book: {name: "5etools SRD", itemId: null, systemVersion: "", isOwned: true},
						});
						d20plus.ut.log(`[Charactermancer] Injected list definition: ${listName}`);
					}
				}
			}

			// Make sure total pages is at least 1 if anything has been added
			// This prevents infinite reloading
			if (pages?.length > 0 && data?.extensions?.totalPages == undefined) {
				data.extensions.totalPages = 1;
				data.extensions.pageNumber = 1;
			}
		} catch (e) {
			console.error("[B20 Charactermancer]", e);
		}

		return new Response(JSON.stringify(data), {status: 200, headers: {"Content-Type": "application/json"}});
	};

}

SCRIPT_EXTENSIONS.push(d20plus2024Charactermancer);

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
	const CASTER_MAP = {"full": "full", "1/2": "half", "1/3": "third", "artificer": "half", "pact": "pact"};
	const SIZE_MAP = {T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan"};
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

	let _clsP = null, _raceP = null, _bgP = null, _subclsP = null;
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
	function eqItemToR20 (item) {
		if (typeof item === "string") return {items: [cleanItem(item)], numOfChoices: 1};
		if (item.equipmentType) {
			return {
				items: [EQUIP_TYPE_MAP[item.equipmentType] || item.equipmentType],
				numOfChoices: item.quantity || 1,
			};
		}
		if (item.item) {
			const name = cleanItem(item.item);
			return {items: [item.quantity > 1 ? `${name} (${item.quantity})` : name], numOfChoices: 1};
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
				const firstKey   = keys[0];
				const firstName  = group[firstKey]?.map?.(i => eqItemToR20(i).items[0]).filter(Boolean).join(" + ") || `Choice ${choiceIdx}`;
				recs.push({
					name: choiceName, parent: eqContName, level: "1",
					builderDisplayName: firstName, multiclass: "FALSE",
					payload: pay({type: "Starting Equipment", subtype: "choice", items: [], numOfChoices: 1}),
				});

				for (const [opt, optItems] of Object.entries(group)) {
					const label = opt.toUpperCase();

					// Separate list items from fixed named items
					const listItems   = [];
					const namedItems  = [];
					let   numChoices  = 1;

					for (const raw of optItems) {
						const {items, numOfChoices} = eqItemToR20(raw);
						for (const it of items) {
							if (it.startsWith("Lists:")) { listItems.push(it); numChoices = numOfChoices; }
							else namedItems.push(it);
						}
					}

					if (listItems.length && namedItems.length) {
						// Fixed items + a list choice bundled together
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
						recs.push({
							name: `${n} Equipment ${label}`, parent: choiceName, level: "1",
							builderDisplayName: namedItems.join(", ") || `Option ${label}`, multiclass: "FALSE",
							payload: pay({type: "Starting Equipment", subtype: "fixed", items: namedItems}),
						});
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
					payload: pay({type: "Language Choice", numOfChoices: anyLangs, list: ["Any"]})});
			}
		}

		return recs;
	}

	// ── Build data-datarecords for a background ───────────────────────────────

	function buildBgRecords (bg) {
		const recs = [];
		const n = bg.name;

		// Background top-level record
		const bgDesc = (bg.entries || [])
			.filter(e => typeof e === "string")
			.join(" ").trim();
		recs.push({name: n, level: "1",
			payload: pay({type: "Background", name: n, description: bgDesc})});

		// Skill proficiencies
		const skillProfs = (bg.skillProficiencies || [])[0] || {};
		for (const [skill, val] of Object.entries(skillProfs)) {
			if (!val || skill === "choose") continue;
			const skillName = skill.charAt(0).toUpperCase() + skill.slice(1).replace(/([A-Z])/g, " $1").trim();
			recs.push({
				name: `${skillName} Proficiency`, parent: n, level: "1",
				builderDisplayName: "Background Skill Proficiencies",
				payload: pay({type: "Proficiency", category: "Skill", proficiency: skillName,
					proficiencyLevel: "Proficient", increaseIfAlreadyAt: false}),
			});
		}

		// Tool proficiencies
		const toolProfs = (bg.toolProficiencies || [])[0] || {};
		for (const [tool, val] of Object.entries(toolProfs)) {
			if (!val || tool === "choose") continue;
			const toolName = tool.charAt(0).toUpperCase() + tool.slice(1).replace(/([A-Z])/g, " $1").trim();
			recs.push({
				name: `${toolName} Proficiency`, parent: n, level: "1",
				builderDisplayName: "Background Tool Proficiencies",
				payload: pay({type: "Proficiency", category: "Tool", proficiency: toolName,
					proficiencyLevel: "Proficient", increaseIfAlreadyAt: false}),
			});
		}

		// Language proficiencies
		const langProfs = (bg.languageProficiencies || [])[0] || {};
		const anyLangs = langProfs.anyStandard || langProfs.any || 0;
		if (anyLangs) {
			recs.push({name: `${n} Language Choice`, parent: n, level: "1",
				payload: pay({type: "Language Choice", numOfChoices: anyLangs, list: ["Any"]})});
		}

		// Background feature (first named entries block)
		const featureEntry = (bg.entries || []).find(e => e?.name && e.type !== "list");
		if (featureEntry) {
			recs.push({
				name: featureEntry.name, parent: n, level: "1",
				payload: pay({type: "Features", name: featureEntry.name, description: renderDesc(featureEntry.entries)}),
			});
		}

		// Starting currency
		const goldMap = {"Noble": 25, "Knight": 25, "Hermit": 5, "Outlander": 10, "Folk Hero": 10, "Sage": 10, "Soldier": 10, "Sailor": 10, "Pirate": 10};
		const gold = goldMap[n] ?? 15;
		recs.push({name: `${n} Starting Gold`, parent: n, level: "1",
			builderDisplayName: "Starting Currency",
			payload: pay({type: "Starting Currency", gold})});

		return recs;
	}

	// ── Charactermancer entry builders ────────────────────────────────────────

	function classEntry (cls) {
		const sts = savingThrows(cls);
		const spellAbility = cls.spellcastingAbility ? ABV[cls.spellcastingAbility] : null;
		const casterType   = spellAbility ? (CASTER_MAP[cls.casterProgression] || "full") : null;
		const entry = {
			id: makeId(`class:${cls.name}:${cls.source}`),
			name: cls.name,
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
			name: race.name,
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
		const entry = {
			id: makeId(`bg:${bg.name}:${bg.source}`),
			name: bg.name,
			properties: {
				"Category": "Backgrounds",
				"data-List": "false",
				"data-builderImage": "",
				"data-datarecords": JSON.stringify(buildBgRecords(bg)),
			},
			children: [],
			publisher: {name: "5etools", logoUrl: ""},
			book: book(bg.source),
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
			name: subcls.name,
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

	// Extract the class name from a Subclasses category query.
	// Roll20 hex-encodes the first letter in the regex filter:
	//   JSON body contains (.*?)\\\\x57izard(.*?)  (4 raw backslashes before xNN)
	function extractSubclassTargetClass (body) {
		const m = body.match(/\(\.\*\?\)(.*?)\(\.\*\?\)/);
		if (!m) return null;
		let raw = m[1];
		// Replace any run of backslashes + xNN with the decoded character
		raw = raw.replace(/\\+x([0-9a-fA-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
		raw = raw.replace(/\\/g, ""); // strip any leftover backslashes
		return raw.trim() || null;
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
		// Order matters: check Subclasses before Classes (substring containment)
		const isSubclasses = body.includes("Subclasses");
		const isClasses    = !isSubclasses && body.includes("Classes");
		const isRaces      = body.includes("Races");
		const isBgs        = body.includes("Backgrounds");

		if (!isBooks && !isClasses && !isSubclasses && !isRaces && !isBgs) return _origFetch.apply(this, args);

		const response = await _origFetch.apply(this, args);
		let data;
		try { data = await response.json(); } catch (e) { return response; }

		try {
			if (isBooks) {
				const books = data?.data?.ruleSystem?.books;
				if (Array.isArray(books) && !books.find(b => b.itemId === "5")) {
					books.push(PHB_BOOK);
					d20plus.ut.log("[Charactermancer] Injected PHB into books response");
				}
			}

			const pages = data?.data?.ruleSystem?.category?.filterAndSortPages;
			if (Array.isArray(pages)) {
				// Deduplicate against whatever the server already returned (owned-book content)
				const existing = new Set(pages.map(p => p.name.toLowerCase()));
				const inject = (all, toEntry) => all
					.filter(x => !existing.has(x.name.toLowerCase()))
					.map(x => { try { return toEntry(x); } catch (e) { return null; } })
					.filter(Boolean);

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
			}
		} catch (e) {
			console.error("[B20 Charactermancer]", e);
		}

		return new Response(JSON.stringify(data), {status: 200, headers: {"Content-Type": "application/json"}});
	};

}

SCRIPT_EXTENSIONS.push(d20plus2024Charactermancer);

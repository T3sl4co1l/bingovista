/*
 *	Converts CHALLENGE_DEFS objects from well-formatted idiomatic JS to JSON.
 *	Includes packing sprite data as inline URI.
 */

const CHAR_MAX = 250;
const INT_MAX = 30000;
const INT_MIN = -30000;

document.addEventListener("DOMContentLoaded", function() {
	document.getElementById("load").addEventListener("click", load);
	document.getElementById("refresh").addEventListener("click", refresh);

	//	suggest files to convert
	var s = "Files required: ";
	for (var i = 0; i < pack.atlases.length; i++) {
		s += pack.atlases[i].imgOrig + ", " + pack.atlases[i].txtOrig + ", ";
	}
	document.getElementById("sources").innerHTML = s.slice(0, -2);
});

function load(e) {
	var i, idx, inp = document.getElementById("in");
	var needed = [];
	for (i = 0; i < pack.atlases.length; i++) {
		needed.push(pack.atlases[i].imgOrig);
		needed.push(pack.atlases[i].txtOrig);
		pack.atlases[i].img = ""; pack.atlases[i].txt = "";
	}
	for (i = 0; i < inp.files.length; i++) {
		idx = needed.indexOf(inp.files[i].name);
		if (idx >= 0) {
			inp.files[i].arrayBuffer().then(
				(function(fn) {
					return function(a) {
						var j, mime, s;
						a = new Uint8Array(a);
						mime = "application/octet-stream";
						fn = fn.toLowerCase();
						if (fn.search(/\.png$/) >= 0)
							mime = "image/png";
						else if (fn.search(/\.txt$/) >= 0)
							mime = "text/plain";
						else if (fn.search(/\.json$/) >= 0)
							mime = "application/json";
						s = "data:" + mime + ";base64," + btoa(String.fromCharCode.apply(null, a));
						//	now where did that go...
						for (j = 0; j < pack.atlases.length; j++) {
							if (pack.atlases[j].imgOrig === fn) {
								pack.atlases[j].img = s;
								break;
							}
							if (pack.atlases[j].txtOrig === fn) {
								pack.atlases[j].txt = s;
								break;
							}
						}
					}
				})(needed[idx])
			);
			needed.splice(idx, 1);
		}
	}
}

function refresh(e) {
	//	Start by stripping un-JSON-ifiable parts...
	var s = JSON.stringify(pack, function(k, v) {
		var blacklist = ["comment", "imgOrig", "txtOrig"];
		if (blacklist.indexOf(k) >= 0)
			return undefined;
		return v;
	});
	var obj = JSON.parse(s);
	//	Add them back in in string format
	const toFuncs = ["toPaint", "toDesc", "toComment", "toBinary"];
	for (var i = 0; i < pack.challenges.length; i++) {
		for (var j = 0; j < toFuncs.length; j++) {
			if (pack.challenges[i][toFuncs[j]] !== undefined)
				obj.challenges[i][toFuncs[j]] = 
						pack.challenges[i][toFuncs[j]].toString()
						.replace(/^function\(\p\) \{\r\n/, "")
						.replace(/\r\n\t+\}$/, "");
		}
	}
	s = JSON.stringify(obj);
	document.getElementById("challenges").value = s;
}

//	possible fixups:
//	AllRegionsExcept: was briefly (in beta) non-Watcher version --> add to challengeUpgrades?
//	any W- enums (Wfood, Wfriend, Wpassage, Wpearls, Wpoms, Wtheft, Wtolls, Wtransport, WweaverRooms)
//	--> solved by upgrade(replace) or ignoring (logs parse error, uses template list)

//	need enums:
//	additions to: banitem, expobject,
//	food, friend, iterators, pinnable, theft, transport, weapons
//	new: weaverrooms --> temporarily solved with embedded general string; can shorten with -Ex later
//	spinners, pomegranateregions --> copy from regions

const pack = {
	"name": "Watcher Expeditions",
	"version": "1.1",
	"hash": "db5d5bd8",
	"date": "20260302",
	"creator": "T3sl4co1l",
	"settingsBytes": 1,
	"mapLink": "https://alduris.github.io/watcher-map/map.html",
	"atlases": [	//	Orig: file; txt/img: loaded with URI on make
		{ "imgOrig": "watchericons.png", "img": "", "txtOrig": "watchericons.txt", "txt": "" },
		{ "imgOrig": "watcheruisprites.png", "img": "", "txtOrig": "watcheruisprites.txt", "txt": "" }
	],
	"challengeUpgrades": {
		//	Renamed or obsoleted challenges; check that desc is identical/compatible
		//	key: challenge name to replace; value: name to replace it with
		//	Alternate solution: use "-Ex" challenge substitution (see bottom of file)
		"BingoAllRegionsExceptChallenge":    "WatcherBingoAllRegionsExceptChallenge",
		"BingoEnterRegionChallenge":         "WatcherBingoEnterRegionChallenge",
		"BingoNoRegionChallenge":            "WatcherBingoNoRegionChallenge",
		"WatcherBingoAchievementChallenge":  "BingoAchievementChallenge",
		"WatcherBingoBombTollChallenge":     "BingoBombTollChallenge",
		"WatcherBingoCollectPearlChallenge": "BingoCollectPearlChallenge",
		"WatcherBingoEatChallenge":          "BingoEatChallenge",
		"WatcherBingoStealChallenge":        "BingoStealChallenge",
		"WatcherBingoTameChallenge":         "BingoTameChallenge"
	},
	"maps": [
		{ "target": "characters",   "add": [
			{ "name": "Watcher", "text": "Watcher", "color": "#17234e", "icon": "Kill_Slugcat" }
		], "comment": "type: array of objects, .name: <string>, .text: <string>, .color: <string>, .icon: 'Kill_Slugcat'" },
		{ "target": "creatures",    "add": [
			{ "name": "AltSkyWhale",       "text": "Sky Whales",           "icon": "Kill_SkyWhale",            "color": "#807359" },
 			{ "name": "Angler",            "text": "Anglers",              "icon": "Kill_Angler",              "color": "#ffffff" },
			{ "name": "Barnacle",          "text": "Barnacles",            "icon": "Kill_Barnacle",            "color": "#ffffff" },
			{ "name": "BasiliskLizard",    "text": "Basilisk Lizards",     "icon": "Kill_Basilisk",            "color": "#b34c00" },
			{ "name": "BigMoth",           "text": "Big Moths",            "icon": "Kill_BigMoth",             "color": "#ffffff" },
			{ "name": "BigSandGrub",       "text": "Sand Worms",           "icon": "Kill_BigSandGrub",         "color": "#ffffff" },
			{ "name": "BlizzardLizard",    "text": "Blizzard Lizards",     "icon": "Kill_BlizzardLizard",      "color": "#8c99b3" },
			{ "name": "BoxWorm",           "text": "Box Worms",            "icon": "Kill_BoxWorm",             "color": "#00e8e6" },
			{ "name": "DrillCrab",         "text": "Drill Crabs",          "icon": "Kill_DrillCrab",           "color": "#a9a4b2" },
			{ "name": "FireSprite",        "text": "Fire Sprites",         "icon": "Kill_FireSprite",          "color": "#00e8e6" },
			{ "name": "Frog",              "text": "Frogs",                "icon": "Kill_Frog",                "color": "#ad4436" },
			{ "name": "GrappleSnake",      "text": "Grapple Snakes",       "icon": "Futile_White",             "color": "#a9a4b2" },
			{ "name": "IndigoLizard",      "text": "Indigo Lizards",       "icon": "Kill_IndigoLizard",        "color": "#4c00cc" },
			{ "name": "Loach",             "text": "Loaches",              "icon": "Kill_Loach",               "color": "#ffffff" },
			{ "name": "Millipede",         "text": "Millipedes",           "icon": "Futile_White",             "color": "#ffeb04" },
			{ "name": "MothGrub",          "text": "Moth Grubs",           "icon": "Kill_MothGrub",            "color": "#ffb38c" },
			{ "name": "PeachLizard",       "text": "Peach Lizards",        "icon": "Kill_PeachLizard",         "color": "#ff7883" },
			{ "name": "Rat",               "text": "Rats",                 "icon": "Kill_Rat",                 "color": "#ad4436" },
			{ "name": "Rattler",           "text": "Bone Shakers",         "icon": "Kill_Rattler",             "color": "#4c00ff" },
			{ "name": "RippleSpider",      "text": "Ripple Spiders",       "icon": "Kill_Rattler",             "color": "#ffffff" },
			{ "name": "RotLoach",          "text": "Rot Behemoths",        "icon": "Kill_RotLoach",            "color": "#4c00ff" },
			{ "name": "SandGrub",          "text": "Sand Grubs",           "icon": "Kill_SandGrub",            "color": "#ffffff" },
			{ "name": "ScavengerDisciple", "text": "Scavenger Disciples",  "icon": "Kill_ScavengerDisciple",   "color": "#ffcc4c" },
			{ "name": "ScavengerTemplar",  "text": "Scavenger Templars",   "icon": "Kill_ScavengerTemplar",    "color": "#ffcc4c" },
			{ "name": "SkyWhale",          "text": "Sky Whales",           "icon": "Kill_SkyWhale",            "color": "#ffffff" },
			{ "name": "SmallMoth",         "text": "Small Moths",          "icon": "Kill_SmallMoth",           "color": "#ffffff" },
			{ "name": "Tardigrade",        "text": "Tardigrades",          "icon": "Kill_Tardigrade",          "color": "#00e8e6" },
			{ "name": "TowerCrab",         "text": "Tower Crabs",          "icon": "Kill_DrillCrab",           "color": "#51382e" }
		], "comment": "type: array of objects, .name: <string>, .text: <string>, .icon: <string>, .color: <string>" },
		{ "target": "expflags",     "add": [
			{ "name": "WB_DIAL",   "byte": 0, "value":  1, "title": "Perk: Dial Warp",       "group": "unl-watcher-dialwarp"    },
			{ "name": "WA_CAMO",   "byte": 0, "value":  2, "title": "Perk: Camouflage",      "group": "unl-watcher-camo"        },
			{ "name": "WA_RANG",   "byte": 0, "value":  4, "title": "Perk: Permanent Warps", "group": "unl-watcher-permwarp"    },
			{ "name": "WA_POISON", "byte": 0, "value":  8, "title": "Perk: Poison Spear",    "group": "unl-watcher-PoisonSpear" },
			{ "name": "WA_WARP",   "byte": 0, "value": 16, "title": "Perk: Boomerang Fever", "group": "unl-watcher-boomerang"   },
			{ "name": "WA_ROTTED", "byte": 0, "value": 32, "title": "Burden: Rotten",        "group": "bur-watcher_rot"         }
		], "comment": "type: array of objects, .name: <string>, .byte: <number>, .value: <number>, .title: <string>, .group: <string>; bit flags stored in activeMods[idx].settings[.byte] & (.value); from Bingo and Watcher Expeditions mods" },
		{ "target": "items",        "add": [
			{ "name": "RotDangleFruit",  "text": "Rot Fruits",          "icon": "Symbol_RotFruit",         "color": "#4c00ff" },
			{ "name": "RotSeedCob",      "text": "Rot Popcorn",         "icon": "Symbol_RotcornPlant",     "color": "#ae281e" },
			{ "name": "Pomegranate",     "text": "Pomegranates",        "icon": "Symbol_Pomegranate",      "color": "#45b530" },
			{ "name": "Boomerang",       "text": "Boomerangs",          "icon": "Symbol_Boomerang",        "color": "#a9a4b2" },
			{ "name": "GraffitiBomb",    "text": "Graffiti Bombs",      "icon": "Symbol_GraffitiBomb",     "color": "#9966ff" },
			{ "name": "FireSpriteLarva", "text": "Fire Sprite Larvae",  "icon": "Symbol_FireSpriteLarva",  "color": "#a9a4b2" },
			{ "name": "SoftToy",         "text": "Squish Toy",          "icon": "Symbol_SoftToy",          "color": "#ff00ff" },
			{ "name": "BallToy",         "text": "Ball Toy",            "icon": "Symbol_BallToy",          "color": "#ff9898" },
			{ "name": "SpinToy",         "text": "Spinning Toy",        "icon": "Symbol_SpinToy",          "color": "#807359" },
			{ "name": "WeirdToy",        "text": "Weird Toy",           "icon": "Symbol_WeirdToy",         "color": "#ad4436" },
			{ "name": "RippleSpawn",     "text": "Ripple Spawns",       "icon": "Futile_White",            "color": "#a9a4b2" },
			{ "name": "PrinceBulb",      "text": "Prince Bulbs",        "icon": "Futile_White",            "color": "#a9a4b2" },
			{ "name": "Prince",          "text": "Princes",             "icon": "Futile_White",            "color": "#a9a4b2" },
			{ "name": "KnotSpawn",       "text": "Knot Spawns",         "icon": "Futile_White",            "color": "#a9a4b2" }
		], "comment": "type: array of objects, .name: <string>, .text: <string>, .icon: <string>, .color: <string>; from strings.txt, WatcherEnums.AbstractObjectType::RegisterValues" },
		{ "target": "iterators",    "add": [
		], "comment": "type: array of objects, .name: <string>, .text: <string>, .icon: <string>, .color: <string>" },
		{ "target": "passage",      "add": [
		], "comment": "type: array of objects, .name: <string>, .text: <string>, .icon: <string>" },
		{ "target": "pearls",       "add": [
			{ "name": "WARG_AUDIO_GROOVE",        "text": "Pink",                 "region": "WARG", "maincolor": "#f33319", "highlight": "#ff664c", "color": "#935cf1" },
			{ "name": "WSKD_AUDIO_JAM2",          "text": "Gold Audio",           "region": "WSKD", "maincolor": "#8fd747", "highlight": "#dcffa6", "color": "#ab86ee" },
			{ "name": "WSKC_ABSTRACT",            "text": "Dark Teal",            "region": "WSKC", "maincolor": "#e6b380", "highlight": "#ffe6cc", "color": "#0f7a7a" },
			{ "name": "WBLA_AUDIO_VOICEWIND1",    "text": "Deep Magenta Audio",   "region": "WBLA", "maincolor": "#007373", "highlight": "#b39494", "color": "#8d32d0" },
			{ "name": "WARD_TEXT_STARDUST",       "text": "Bright Viridian",      "region": "WARD", "maincolor": "#cc14a6", "highlight": "#191919", "color": "#59e6a6" },
			{ "name": "WARE_AUDIO_VOICEWIND2",    "text": "Brown Audio",          "region": "WARE", "maincolor": "#59e6a6", "highlight": "#191919", "color": "#8e4acc" },
			{ "name": "WARB_TEXT_SECRET",         "text": "Dark Purple",          "region": "WARB", "maincolor": "#66c066", "highlight": "#191919", "color": "#803399" },
			{ "name": "WARC_TEXT_CONTEMPT",       "text": "Pale Pink",            "region": "WARC", "maincolor": "#f3a605", "highlight": "#191919", "color": "#bd7a8a" },
			{ "name": "WPTA_DRONE",               "text": "Beige",                "region": "WPTA", "maincolor": "#803399", "highlight": "#191919", "color": "#e8ba8a" },
			{ "name": "WRFB_AUDIO_JAM4",          "text": "Bright Magenta Audio", "region": "WRFB", "maincolor": "#bd7a8a", "highlight": "#191919", "color": "#af3afb" },
			{ "name": "WTDA_AUDIO_JAM1",          "text": "Green Audio",          "region": "WTDA", "maincolor": "#6c40f2", "highlight": "#85ff21", "color": "#8e93f3" },
			{ "name": "WTDB_AUDIO_JAM3",          "text": "Viridian Audio",       "region": "WTDB", "maincolor": "#7249ed", "highlight": "#ffd733", "color": "#6e94f8" },
			{ "name": "WVWA_TEXT_KITESDAY",       "text": "Amber",                "region": "WVWA", "maincolor": "#6839f6", "highlight": "#14ff96", "color": "#f3a605" },
			{ "name": "WMPA_TEXT_NOTIONOFSELF",   "text": "Pale Viridian",        "region": "WMPA", "maincolor": "#6635f8", "highlight": "#ff0cff", "color": "#66c066" },
			{ "name": "WORA_WORA",                "text": "Light Green",          "region": "WORA", "maincolor": "#7045ef", "highlight": "#ff8095", "color": "#a0de5c" },
			{ "name": "WAUA_WAUA",                "text": "Orange",               "region": "WAUA", "maincolor": "#762dcb", "highlight": "#610c3d", "color": "#f74f31" },
			{ "name": "WAUA_TEXT_AUDIO_TALKSHOW", "text": "Light Magenta",        "region": "WAUA", "maincolor": "#7934ca", "highlight": "#6a4719", "color": "#cc14a6" }
		], "comment": "type: array of objects, .name: <string>, .text: <string>, .region: <string>, .maincolor: <string>, .highlight: <string>, .color: <string>; colors from DataPearl::UniquePearlHighLightColor, keys from Watcher Bingo, names from Wiki https://rainworld.miraheze.org/wiki/Pearl/Dialogue/Watcher" },
		{ "target": "regions",      "add": [
			{ "code": "WARF", "text": "Aether Ridge",          "saintText": "" },
			{ "code": "WBLA", "text": "Badlands",              "saintText": "" },
			{ "code": "WARD", "text": "Cold Storage",          "saintText": "" },
			{ "code": "WRFA", "text": "Coral Caves",           "saintText": "" },
			{ "code": "WTDB", "text": "Desolate Tract",        "saintText": "" },
			{ "code": "WARC", "text": "Fetid Glen",            "saintText": "" },
			{ "code": "WVWB", "text": "Fractured Gateways",    "saintText": "" },
			{ "code": "WARE", "text": "Heat Ducts",            "saintText": "" },
			{ "code": "WMPA", "text": "Migration Path",        "saintText": "" },
			{ "code": "WPGA", "text": "Pillar Grove",          "saintText": "" },
			{ "code": "WRRA", "text": "Rusted Wrecks",         "saintText": "" },
			{ "code": "WARB", "text": "Salination",            "saintText": "" },
			{ "code": "WSKD", "text": "Shrouded Stacks",       "saintText": "" },
			{ "code": "WPTA", "text": "Signal Spires",         "saintText": "" },
			{ "code": "WSKC", "text": "Stormy Coast",          "saintText": "" },
			{ "code": "WSKB", "text": "Sunbaked Alley",        "saintText": "" },
			{ "code": "WARG", "text": "The Surface",           "saintText": "" },
			{ "code": "WSKA", "text": "Torrential Railways",   "saintText": "" },
			{ "code": "WTDA", "text": "Torrid Desert",         "saintText": "" },
			{ "code": "WRFB", "text": "Turbulent Pump",        "saintText": "" },
			{ "code": "WVWA", "text": "Verdant Waterways",     "saintText": "" },
			{ "code": "WARA", "text": "Shattered Terrace",     "saintText": "" },
			{ "code": "WRSA", "text": "Daemon",                "saintText": "" },
			{ "code": "WAUA", "text": "Ancient Urban",         "saintText": "" },
			{ "code": "WHIR", "text": "Corrupted Factories",   "saintText": "" },
			{ "code": "WSUR", "text": "Crumbling Fringes",     "saintText": "" },
			{ "code": "WDSR", "text": "Decaying Tunnels",      "saintText": "" },
			{ "code": "WGWR", "text": "Infested Wastes",       "saintText": "" },
			{ "code": "WSSR", "text": "Unfortunate Evolution", "saintText": "" },
			{ "code": "WORA", "text": "Outer Rim",             "saintText": "" }
		], "comment": "type: array of objects, .code: <string>, .text: <string>, .saintText: <string>; regions and names from https://alduris.github.io/watcher-map/" },
		{ "target": "unlocksblue",  "add": [
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Barnacle",          "text": "Barnacles",           "icon": "Kill_Barnacle",          "color": "#ffffff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Tardigrade",        "text": "Tardigrades",         "icon": "Kill_Tardigrade",        "color": "#00e8e6" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Frog",              "text": "Frogs",               "icon": "Kill_Frog",              "color": "#ad4436" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "DrillCrab",         "text": "Drill Crabs",         "icon": "Kill_DrillCrab",         "color": "#a9a4b2" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "SandGrub",          "text": "Sand Grubs",          "icon": "Kill_SandGrub",          "color": "#ffffff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "BigSandGrub",       "text": "Sand Worms",          "icon": "Kill_BigSandGrub",       "color": "#ffffff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "SmallMoth",         "text": "Small Moths",         "icon": "Kill_SmallMoth",         "color": "#ffffff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "BigMoth",           "text": "Big Moths",           "icon": "Kill_BigMoth",           "color": "#ffffff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "BoxWorm",           "text": "Box Worms",           "icon": "Kill_BoxWorm",           "color": "#00e8e6" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "FireSprite",        "text": "Fire Sprites",        "icon": "Kill_FireSprite",        "color": "#00e8e6" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "ScavengerTemplar",  "text": "Scavenger Templars",  "icon": "Kill_ScavengerTemplar",  "color": "#ffcc4c" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "ScavengerDisciple", "text": "Scavenger Disciples", "icon": "Kill_ScavengerDisciple", "color": "#ffcc4c" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Loach",             "text": "Loaches",             "icon": "Kill_Loach",             "color": "#ffffff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "RotLoach",          "text": "Rot Behemoths",       "icon": "Kill_RotLoach",          "color": "#4c00ff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Rattler",           "text": "Bone Shakers",        "icon": "Kill_Rattler",           "color": "#4c00ff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "IndigoLizard",      "text": "Indigo Lizards",      "icon": "Kill_IndigoLizard",      "color": "#4c00cc" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "BlizzardLizard",    "text": "Blizzard Lizards",    "icon": "Kill_BlizzardLizard",    "color": "#8c99b3" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "BasiliskLizard",    "text": "Basilisk Lizards",    "icon": "Kill_Basilisk",          "color": "#b34c00" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "PeachLizard",       "text": "Peach Lizards",       "icon": "Kill_PeachLizard",       "color": "#ff7883" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "ProtoLizard",       "text": "Proto Lizards",       "icon": "",                       "color": ""        },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "RotLizard",         "text": "Rot Lizards",         "icon": "",                       "color": ""        },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Rat",               "text": "Rats",                "icon": "Kill_Rat",               "color": "#ad4436" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Angler",            "text": "Anglers",             "icon": "Kill_Angler",            "color": "#ffffff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "SkyWhale",          "text": "Sky Whales",          "icon": "Kill_SkyWhale",          "color": "#ffffff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "AltSkyWhale",       "text": "Sky Whales",          "icon": "Kill_SkyWhale",          "color": "#807359" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "RotDangleFruit",    "text": "Rot Fruits",          "icon": "Symbol_RotFruit",        "color": "#4c00ff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "RotSeedCob",        "text": "Rot Popcorn",         "icon": "Symbol_RotcornPlant",    "color": "#ae281e" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Pomegranate",       "text": "Pomegranates",        "icon": "Symbol_Pomegranate",     "color": "#0eb23c" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "Boomerang",         "text": "Boomerangs",          "icon": "Symbol_Boomerang",       "color": "#a9a4b2" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "GraffitiBomb",      "text": "Graffiti Bombs",      "icon": "Symbol_GraffitiBomb",    "color": "#9966ff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "BallToy",           "text": "Ball Toy",            "icon": "Symbol_BallToy",         "color": "#ff9898" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "SoftToy",           "text": "Squish Toy",          "icon": "Symbol_SoftToy",         "color": "#ff00ff" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "SpinToy",           "text": "Spinning Toy",        "icon": "Symbol_SpinToy",         "color": "#807359" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "WeirdToy",          "text": "Weird Toy",           "icon": "Symbol_WeirdToy",        "color": "#ad4436" },
			{ "type": "blue", "unlockColor": "#3985d5", "name": "MothGrub",          "text": "Moth Grubs",          "icon": "Kill_MothGrub",          "color": "#ffb38c" }
		], "comment": "type: array of objects, .type: 'blue', .unlockColor: '#3985d5', .name: <string>, .text: <string>, .icon: <string>, .color: <string>; from WatcherEnums.SandboxUnlockID::RegisterValues" },
		{ "target": "unlocksgold",  "add": [
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WSKA", "text": "WSKA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WSKB", "text": "WSKB", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WRFA", "text": "WRFA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WRRA", "text": "WRRA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WPGA", "text": "WPGA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WARF", "text": "WARF", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WSKD", "text": "WSKD", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WMPA", "text": "WMPA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WTDA", "text": "WTDA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WTDB", "text": "WTDB", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WARG", "text": "WARG", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WARD", "text": "WARD", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WBLA", "text": "WBLA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WARE", "text": "WARE", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WRFB", "text": "WRFB", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WSKC", "text": "WSKC", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WVWA", "text": "WVWA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WVWB", "text": "WVWB", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WARB", "text": "WARB", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WARC", "text": "WARC", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WPTA", "text": "WPTA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WARA", "text": "WARA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "WAUA", "text": "WAUA", "icon": "", "color": "" },
			{ "type": "gold", "unlockColor": "#ff990c", "name": "HP",   "text": "HP",   "icon": "", "color": "" }
		], "comment": "type: array of objects, .type: 'gold', .unlockColor: '#ff990c', .name: <string>, .text: <string>, .icon: '', .color: ''; .icon and .color are unread but populated as empty string for consistency in combined unlocks list; from Watcher.MultiplayerUnlocks::LevelLockID" },
		{ "target": "unlocksred",   "add": [], "comment": "type: array of objects, .type: 'red', .unlockColor: '#ff0000', .name: <string>, .text: <string>, .icon: '', .color: ''; .icon and .color are unread but populated as empty string for consistency in combined unlocks list" },
		{ "target": "unlocksgreen", "add": [
			{ "type": "green", "unlockColor": "#43d539", "name": "Watcher", "text": "Watcher", "icon": "Kill_Slugcat", "color": "#17234e" }
		], "comment": "type: array of objects, .type: 'green', .unlockColor: '#43d539', .name: <string>, .text: <string>, .icon: 'Kill_Slugcat', .color: <string>" },
		{ "target": "vistas",       "add": [
			{ "region": "WARF", "room": "WARF_B17", "x":  461, "y":  290 },
			{ "region": "WARF", "room": "WARF_C02", "x": 2110, "y":  330 },
			{ "region": "WARF", "room": "WARF_D26", "x":  600, "y":  100 },
			{ "region": "WBLA", "room": "WBLA_F02", "x": 5180, "y":  700 },
			{ "region": "WBLA", "room": "WBLA_B05", "x": 1650, "y":  490 },
			{ "region": "WBLA", "room": "WBLA_J01", "x": 4853, "y":  650 },
			{ "region": "WARD", "room": "WARD_D36", "x":  590, "y":  570 },
			{ "region": "WARD", "room": "WARD_E26", "x": 1300, "y":  590 },
			{ "region": "WARD", "room": "WARD_E28", "x":  590, "y":  290 },
			{ "region": "WRFA", "room": "WRFA_F06", "x": 1290, "y": 1525 },
			{ "region": "WRFA", "room": "WRFA_E02", "x": 1488, "y":  300 },
			{ "region": "WRFA", "room": "WRFA_SK0", "x":   25, "y":  250 },
			{ "region": "WTDB", "room": "WTDB_A08", "x":  475, "y":  634 },
			{ "region": "WTDB", "room": "WTDB_A22", "x": 1545, "y":  660 },
			{ "region": "WTDB", "room": "WTDB_A38", "x":  950, "y":  610 },
			{ "region": "WARC", "room": "WARC_A01", "x":  905, "y":  550 },
			{ "region": "WARC", "room": "WARC_A05", "x": 2450, "y":  570 },
			{ "region": "WARC", "room": "WARC_E03", "x": 1511, "y":  970 },
			{ "region": "WVWB", "room": "WVWB_C01", "x": 2460, "y":  440 },
			{ "region": "WVWB", "room": "WVWB_D02", "x": 1315, "y":  410 },
			{ "region": "WVWB", "room": "WVWB_E02", "x": 1559, "y":  870 },
			{ "region": "WARE", "room": "WARE_H03", "x":  434, "y":  625 },
			{ "region": "WARE", "room": "WARE_H24", "x":  475, "y": 1095 },
			{ "region": "WARE", "room": "WARE_I04", "x":  715, "y":  100 },
			{ "region": "WMPA", "room": "WMPA_D07", "x":  705, "y":  935 },
			{ "region": "WMPA", "room": "WMPA_A08", "x": 1265, "y":  450 },
			{ "region": "WMPA", "room": "WMPA_C03", "x": 1111, "y":  570 },
			{ "region": "WPGA", "room": "WPGA_A09", "x":  150, "y":  400 },
			{ "region": "WPGA", "room": "WPGA_A14", "x":  491, "y":  630 },
			{ "region": "WPGA", "room": "WPGA_A13", "x":  733, "y":  645 },
			{ "region": "WRRA", "room": "WRRA_A09", "x":  492, "y":  328 },
			{ "region": "WRRA", "room": "WRRA_C03", "x": 1472, "y":  348 },
			{ "region": "WRRA", "room": "WRRA_B13", "x":  471, "y":  290 },
			{ "region": "WARB", "room": "WARB_F05", "x": 3590, "y":  510 },
			{ "region": "WARB", "room": "WARB_G26", "x":  490, "y": 1000 },
			{ "region": "WARB", "room": "WARB_F16", "x":  860, "y":  285 },
			{ "region": "WSKD", "room": "WSKD_B33", "x": 2543, "y": 1000 },
			{ "region": "WSKD", "room": "WSKD_B09", "x":  610, "y":  450 },
			{ "region": "WSKD", "room": "WSKD_B20", "x": 1650, "y":  330 },
			{ "region": "WPTA", "room": "WPTA_B04", "x":  390, "y":  210 },
			{ "region": "WPTA", "room": "WPTA_C02", "x":  958, "y": 2235 },
			{ "region": "WPTA", "room": "WPTA_B08", "x":   85, "y":  290 },
			{ "region": "WSKC", "room": "WSKC_A12", "x": 1701, "y":  430 },
			{ "region": "WSKC", "room": "WSKC_A08", "x":  131, "y":  110 },
			{ "region": "WSKC", "room": "WSKC_A27", "x":  110, "y":  185 },
			{ "region": "WSKB", "room": "WSKB_N09", "x":  515, "y":  510 },
			{ "region": "WSKB", "room": "WSKB_C11", "x":  480, "y":  500 },
			{ "region": "WSKB", "room": "WSKB_N11", "x":  853, "y":   63 },
			{ "region": "WARG", "room": "WARG_W08", "x":  460, "y":  545 },
			{ "region": "WARG", "room": "WARG_O05_Future", "x":  950, "y":  285 },
			{ "region": "WARG", "room": "WARG_G19", "x":  585, "y":  490 },
			{ "region": "WSKA", "room": "WSKA_D15", "x": 1515, "y":  830 },
			{ "region": "WSKA", "room": "WSKA_D20", "x":  355, "y":  530 },
			{ "region": "WSKA", "room": "WSKA_D11", "x": 2631, "y":  630 },
			{ "region": "WTDA", "room": "WTDA_B08", "x": 6791, "y":  470 },
			{ "region": "WTDA", "room": "WTDA_Z16", "x": 3759, "y":  308 },
			{ "region": "WTDA", "room": "WTDA_Z01", "x": 1650, "y":  625 },
			{ "region": "WRFB", "room": "WRFB_B01", "x":  489, "y":  110 },
			{ "region": "WRFB", "room": "WRFB_D01", "x":  900, "y":  191 },
			{ "region": "WRFB", "room": "WRFB_F04", "x":  610, "y":    5 },
			{ "region": "WVWA", "room": "WVWA_B08", "x":  950, "y":   -7 },
			{ "region": "WVWA", "room": "WVWA_B06", "x":  702, "y":  490 },
			{ "region": "WVWA", "room": "WVWA_B10", "x": 1443, "y":  170 },
			{ "region": "WARA", "room": "WARA_P09", "x":  311, "y": 2170 },
			{ "region": "WARA", "room": "WARA_P21", "x": 1350, "y":   90 },
			{ "region": "WARA", "room": "WARA_P06", "x":  430, "y":  155 },
			{ "region": "WAUA", "room": "WAUA_A03B","x":  491, "y":  420 },
			{ "region": "WAUA", "room": "WAUA_SHOP","x": 1020, "y":  450 },
			{ "region": "WAUA", "room": "WAUA_E02", "x": 1450, "y":  320 }
		], "comment": "type: array of objects, .region: <string>, .room: <string>, .x: <number>, .y: <number>" }
	],
	"enums": [
		{ "target": "banitem",        "add": [
			"Rat",
			"FireSpriteLarva",
			"Tardigrade",
			"Frog",
			"SandGrub",
			"Barnacle",
			"GraffitiBomb",
			"Boomerang"
		], "comment": "type: array of strings" },
		{ "target": "boolean",        "add": [], "comment": "type: array of strings" },
//		{ "target": "challenges",     "add": [], "comment": "type: array of strings" },	//	auto filled from challenges
//		{ "target": "characters",     "add": [], "comment": "type: array of strings" },	//	auto filled from maps
//		{ "target": "chatlogs",       "add": [], "comment": "type: array of strings" },	//	auto filled from maps
		{ "target": "craft",          "add": [], "comment": "type: array of strings" },
//		{ "target": "creatures",      "add": [], "comment": "type: array of strings" },	//	auto filled from maps
//		{ "target": "depths",         "add": [], "comment": "type: array of strings" },
//		{ "target": "enterablegates", "add": [], "comment": "type: array of strings" },
//		{ "target": "expflags",       "add": [], "comment": "type: array of strings; auto filled from maps
		{ "target": "expobject",      "add": [
			"FireSpriteLarva",
			"GraffitiBomb",
			"Boomerang"
		], "comment": "type: array of strings" },	//	ref: AbstractPhysicalObject.AbstractObjectType
		{ "target": "food",           "add": [
			"Rat",
			"FireSpriteLarva",
			"Tardigrade",
			"Frog",
			"SandGrub",
			"Barnacle"
		], "comment": "type: array of strings" },
		{ "target": "friend",         "add": [
			"PeachLizard",
			"BasiliskLizard",
			"IndigoLizard",
			"BlizzardLizard",
			"ProtoLizard",
			"RotLizard"
		], "comment": "type: array of strings" },
//		{ "target": "items",          "add": [], "comment": "type: array of strings" },	//	auto filled from maps.items
		{ "target": "iterators",      "add": [], "comment": "type: array of strings" },
//		{ "target": "passage",        "add": [], "comment": "type: array of strings" },	//	auto filled from maps.passage
//		{ "target": "pearls",         "add": [], "comment": "type: array of strings" },	//	auto filled from maps.pearls
		{ "target": "pinnable",       "add": [], "comment": "type: array of strings" },
//		{ "target": "regions",        "add": [], "comment": "type: array of strings" },	//	auto filled from maps.regions
//		{ "target": "regionsreal",    "add": [], "comment": "type: array of strings" },	//	auto filled from maps.regions
//		{ "target": "nootregions",    "add": [], "comment": "type: array of strings" },	//	auto filled from maps.regions
//		{ "target": "popcornregions", "add": [], "comment": "type: array of strings" },	//	auto filled from maps.regions
//		{ "target": "echoes",         "add": [], "comment": "type: array of strings" },	//	auto filled from maps.regions
//		{ "target": "subregions",     "add": [], "comment": "type: array of strings" },	//	deprecated
		{ "target": "theft",          "add": [
			"GraffitiBomb",
			"Boomerang"
		], "comment": "type: array of strings" },
		{ "target": "tolls",          "add": [
			"WARF_G01",
			"WBLA_F01",
			"WSKD_B41"
		], "comment": "type: array of strings" },
//		{ "target": "tolls_bombed",   "add": [], "comment": "type: array of strings" },	//	auto filled from enums.tolls
		{ "target": "transport",      "add": [], "comment": "type: array of strings" },
//		{ "target": "unlocks",        "add": [], "comment": "type: array of strings" },	//	auto filled from enums.unlocksblue, gold, red and green
//		{ "target": "unlocksblue",    "add": [], "comment": "type: array of strings" },	//	auto filled from maps
//		{ "target": "unlocksgold",    "add": [], "comment": "type: array of strings" },	//	auto filled from maps
//		{ "target": "unlocksred",     "add": [], "comment": "type: array of strings" },	//	auto filled from maps
//		{ "target": "unlocksgreen",   "add": [], "comment": "type: array of strings" },	//	auto filled from maps
//		{ "target": "vista_code",     "add": [], "comment": "type: array of strings" },	//	auto filled from maps.vistas
//		{ "target": "vista",          "add": [], "comment": "type: array of strings" },	//	auto filled from maps.vistas
//		{ "target": "vista_region",   "add": [], "comment": "type: array of strings" },	//	auto filled from maps.vistas
//		{ "target": "vista_room",     "add": [], "comment": "type: array of strings" },	//	auto filled from maps.vistas
//		{ "target": "vista_x",        "add": [], "comment": "type: array of strings" },	//	auto filled from maps.vistas
//		{ "target": "vista_y",        "add": [], "comment": "type: array of strings" },	//	auto filled from maps.vistas
		{ "target": "weapons",        "add": [
			"GraffitiBomb",
			"Boomerang",
			"Frog",
			"WaterNut"
		], "comment": "type: array of strings" },
//		{ "target": "weaponsnojelly", "add": [], "comment": "type: array of strings" },	//	auto filled from weapons
		{ "target": "pomegranateregions", "copy": "regions" },
		{ "target": "spinners",           "copy": "regions" },
	],
	challenges: [
		{
			name: "WatcherBingoAllRegionsExceptChallenge",
			category: "Entering regions without visiting one",
			super: undefined,
			//	desc of format ["System.String|WARC|Region|0|regionsreal", "CC|DS|HI|GW|SI|SU|SH|SL|LF|UW|SB|SS|MS|OE|HR|LM|DM|LC|RM|CL|UG|VS|WVWA|WVWB|WRRA|WPGA|WARA|WARB|WARC|WARD|WARE|WARF|WARG|WMPA|WAUA|WBLA|WPTA|WRFA|WRFB|WRSA|WSKA|WSKB|WSKC|WSKD|WTDA|WTDB|WORA|WDSR|WGWR|WHIR|WSSR|WSUR", "0", "System.Int32|15|Amount|1|NULL", "0", "0"]
			textUpgrade: {},
			textDowngrade: {},
			template: [
				{
					param: "region", type: "string",
					binType: "number", binOffs: 0, binSize: 1,
					formatter: "regionsreal", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Region", position: "0",
						formatter: "regionsreal", defaultval: "WARF"
					}
				},
				{
					param: "regionsToEnter", type: "list",
					binType: "string", binOffs: 2, binSize: 0,
					formatter: "regionsreal", parse: "list", separator: "|", defaultval: []
				},
				{
					param: "current", type: "number",
					formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0
				},
				{
					param: "required", type: "number",
					binType: "number", binOffs: 1, binSize: 1,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Int32", name: "Amount", position: "1",
						formatter: "NULL", minval: 1, maxval: CHAR_MAX, defaultval: 1
					}
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			],
			toPaint: function(p) {
				return [
					{ type: "icon", value: "TravellerA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
					{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
					{ type: "break" },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white },
					{ type: "break" },
					{ type: "text", value: "[" + String(p.current) + "/" + String(p.required) + "]", color: Bingovista.colors.Unity_white }
				];
			},
			toDesc: function(p) {
				return "Enter " + (((p.required - p.current) > 1) ? String(p.required - p.current) + " more regions" : (((p.required - p.current) > 0) ? "one more region" : "no more regions") ) + " without entering " + this.regionToDisplayText(this.board.character, p.region) + ".";
			},
			toComment: function(p) {
					return "This challenge is potentially quite customizable; only regions in the list need to be entered. Normally, the list is populated with all campaign story regions (i.e. corresponding Wanderer pips), so that progress can be checked on the sheltering screen. All that matters towards completion, is <span class=\"bv-code\">current</span> equaling <span class=\"bv-code\">amount</span>; thus we can set a lower bar and play a \"The Wanderer\"-lite; or we could set a specific collection of regions to enter, to entice players towards them. Downside: the latter functionality is not currently supported in-game: the region list is something of a mystery unless viewed and manually tracked. (This goal generates with all regions listed, so that all will contribute towards the goal.)";
			},
			toBinary: function(p) {
				var b = Array(5); b.fill(0);
				b[0] = this.challengeValue(p._name);
				b[3] = this.enumToValue(p.region, "regionsreal");
				b[4] = Math.max(1, Math.min(p.required - p.current, CHAR_MAX));
				for (var k = 0; k < p.regionsToEnter.length; k++)
					b.push(this.enumToValue(p.regionsToEnter[k], "regionsreal"));
				b.push(0);
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoCollectRippleSpawnChallenge",
			category: "Collecting Ripple Spawn eggs",
			super: undefined,
			//	desc of format ["0", "System.Int32|15|Amount|0|NULL", "System.Boolean|false|In one Cycle|1|NULL", "0", "0"]
			textUpgrade: {},
			textDowngrade: {},
			template: [
				{
					param: "current", type: "number",
					formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
				},
				{
					param: "amount", type: "number",
					binType: "number", binOffs: 0, binSize: 2,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Int32", name: "Amount", position: "0",
						formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
					}
				},
				{
					param: "oneCycle", type: "bool",
					binType: "bool", binOffs: 0, bit: 4,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Boolean", name: "In one Cycle", position: "1",
						formatter: "NULL", defaultval: false
					}
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			],
			toPaint: function(p) {
				var paint = [
					{ type: "icon", value: "ripplespawn", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
					{ type: "break" },
					{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
				];
				if (p.oneCycle)
					paint.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
				return paint;
			},
			toDesc: function(p) {
				var d = "Collect " + this.entityNameQuantify(p.amount, "Ripple Spawn eggs");
				if (p.oneCycle) d += ", in one cycle";
				return d + ".";
			},
			toComment: function(p) {
				return "Ripple Spawn eggs become visible when the player has reinforced Karma, is holding a Karma Flower, or if the Dial Warp perk is enabled.";
			},
			toBinary: function(p) {
				var b = Array(5); b.fill(0);
				b[0] = this.challengeValue(p._name);
				Bingovista.applyBool(b, 1, 4, p.oneCycle);
				Bingovista.applyShort(b, 3, p.amount);
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoCreaturePortalChallenge",
			category: "Transporting the same creature through portals",
			super: undefined,
			//	desc of format ["System.String|CicadaB|Creature Type|1|transport", "0", "System.Int32|3|Amount|0|NULL", "empty", "0", "0"]
			textUpgrade: {
				6: [	//	beta, 1.331-1.34
					{ op: "replace", offs: 0, find: "\\|Wtransport$", replace: "|transport" },
				]
			},
			textDowngrade: {},
			template: [
				{
					param: "crit", type: "string",
					binType: "number", binOffs: 0, binSize: 1,
					formatter: "transport", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Creature Type", position: "1",
						formatter: "transport", altthreshold: 64, altformatter: "creatures", defaultval: "CicadaA"
					}
				},
				{
					param: "current", type: "number",
					formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0
				},
				{
					param: "amount", type: "number",
					binType: "number", binOffs: 1, binSize: 1,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Int32", name: "Amount", position: "0",
						formatter: "NULL", minval: 1, maxval: CHAR_MAX, defaultval: 1
					}
				},
				{
					param: "creaturePortals", type: "list",
					formatter: "", parse: "list", separator: "%", minval: 0, maxval: 252, defaultval: ["empty"]
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			],
			toPaint: function(p) {
				var paint = [
					{ type: "icon", value: this.entityIconAtlas(p.crit), scale: 1, color: this.entityIconColor(p.crit), rotation: 0 },
					{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
					{ type: "icon", value: "portal", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
					{ type: "break" },
					{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
				];
				return paint;
			},
			toDesc: function(p) {
				return "Transport the same " + this.entityNameQuantify(1, this.entityDisplayText(p.crit), false) + " through " + this.entityNameQuantify(p.amount, "portals") + ".";
			},
			toComment: function(p) {
				return "";
			},
			toBinary: function(p) {
				var b = Array(5); b.fill(0);
				b[0] = this.challengeValue(p._name);
				if (this.enums.transport.includes(p.crit))
					b[3] = this.enumToValue(p.crit, "transport");
				else
					b[3] = this.enumToValue(p.crit, "creatures") + 64 - 1;	//	crit template altthreshold
				b[4] = p.amount;
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoEnterRegionChallenge",
			category: "Entering a region",
			super: undefined,
			//	desc of format ["System.String|WARD|Region|0|regionsreal", "0", "0"]
			textUpgrade: {},
			textDowngrade: {},
			template: [
				{
					param: "region", type: "string",
					binType: "number", binOffs: 0, binSize: 1,
					formatter: "regionsreal", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Region", position: "0",
						formatter: "regionsreal", defaultval: "WARA"
					}
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			],
			toPaint: function(p) {
				return [
					{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_green, rotation: 90 },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
				];
			},
			toDesc: function(p) {
				return "Enter " + this.regionToDisplayText(this.board.character, p.region) + ".";
			},
			toComment: function(p) {
				return "";
			},
			toBinary: function(p) {
				var b = Array(4); b.fill(0);
				b[0] = this.challengeValue(p._name);
				b[3] = this.enumToValue(p.region, "regionsreal");
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoHatchMothGrubChallenge",
			category: "Hatching Moth Grubs",
			super: undefined,
			//	desc of format ["System.Boolean|false|At once|1|NULL", "0", "System.Int32|1|Amount|0|NULL", "0", "0"]
			textUpgrade: {},
			textDowngrade: {},
			template: [
				{
					param: "oneCycle", type: "bool",
					binType: "bool", binOffs: 0, bit: 4,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Boolean", name: "At once", position: "1",
						formatter: "NULL", defaultval: false
					}
				},
				{
					param: "current", type: "number",
					formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0
				},
				{
					param: "amount", type: "number",
					binType: "number", binOffs: 0, binSize: 1,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Int32", name: "Amount", position: "0",
						formatter: "NULL", minval: 1, maxval: CHAR_MAX, defaultval: 1
					}
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			],
			toPaint: function(p) {
				var paint = [
					{ type: "icon", value: this.entityIconAtlas("MothGrub"), scale: 1, color: this.entityIconColor("MothGrub"), rotation: 0 },
					{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
					{ type: "icon", value: this.entityIconAtlas("SmallMoth"), scale: 1, color: this.entityIconColor("SmallMoth"), rotation: 0 },
					{ type: "break" },
					{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
				];
				if (p.oneCycle)
					paint.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
				return paint;
			},
			toDesc: function(p) {
				var d = "Hatch " + this.entityNameQuantify(p.amount, this.entityDisplayText("MothGrub"));
				if (p.oneCycle) d += ", in one cycle";
				return d + ".";
			},
			toComment: function(p) {
				return "Big Moths nest on the grounds of Shrouded Stacks, dropping their larvae off in open rooms of the region. A Grub can be lugged to a nearby shelter, to hibernate and hatch.";
			},
			toBinary: function(p) {
				var b = Array(4); b.fill(0);
				b[0] = this.challengeValue(p._name);
				Bingovista.applyBool(b, 1, 4, p.oneCycle);
				b[3] = p.amount;
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoPrinceChallenge",
			category: "Visiting The Prince",
			super: undefined,
			//	desc of format ["0", "0"]
			textUpgrade: {},
			textDowngrade: {},
			template: [
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			],
			toPaint: function(p) {
				return [
					{ type: "icon", value: "prince", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
				];
			},
			toDesc: function(p) {
				return "Visit The Prince.";
			},
			toComment: function(p) {
				return "";
			},
			toBinary: function(p) {
				var b = Array(3); b.fill(0);
				b[0] = this.challengeValue(p._name);
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoNoRegionChallenge",
			category: "Avoiding a region",
			super: undefined,
			//	desc of format ["System.String|WVWA|Region|0|regionsreal", "0", "0"]
			textUpgrade: {},
			textDowngrade: {},
			template: [
				{
					param: "region", type: "string",
					binType: "number", binOffs: 0, binSize: 1,
					formatter: "regionsreal", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Region", position: "0",
						formatter: "regionsreal", defaultval: "WARA"
					} 
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false 
				}
			],
			toPaint: function(p) {
				return [
					{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
				];
			},
			toDesc: function(p) {
				return "Do not enter " + this.regionToDisplayText(this.board.character, p.region) + ".";
			},
			toComment: function(p) {
				return "";
			},
			toBinary: function(p) {
				var b = Array(4); b.fill(0);
				b[0] = this.challengeValue(p._name);
				b[3] = this.enumToValue(p.region, "regionsreal");
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoOpenMelonsChallenge",
			category: "Opening Pomegranates",
			super: undefined,
			//	desc of format (< v1.311) ["0", "System.Int32|2|Amount|0|NULL", "System.Boolean|false|In one Cycle|1|NULL", "0", "0"]
			//	or (>= v1.311) ["System.String|Any Region|Region|1|pomegranateregions", "System.Boolean|true|Different Regions|2|NULL", "System.Boolean|false|In one Cycle|3|NULL", "0", "System.Int32|2|Amount|0|NULL", "", "0", "0"]
			textUpgrade: {
				4: [	//	< v1.27
					{ op: "splice", offs: 2, rem: 0, data: ["System.Boolean|false|In one Cycle|3|NULL"] }
				],
				5: [
					{ op: "move", from: 2, to: 0 },
					{ op: "unshift", data: ["System.String|Any Region|Region|1|pomegranateregions", "System.Boolean|false|Different Regions|2|NULL"] },
					{ op: "splice", offs: 5, rem: 0, data: [""] }
				]
			},
			textDowngrade: {},
			template: [
				{
					param: "region", type: "string",
					formatter: "pomegranateregions", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Region", position: "1",
						formatter: "pomegranateregions", defaultval: "Any Region"
						}
					},
				{
					param: "differentRegions", type: "bool",
					binType: "bool", binOffs: 0, bit: 5,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Boolean", name: "Different Regions", position: "2",
						formatter: "NULL", defaultval: false
						}
					},
				{
					param: "oneCycle", type: "bool",
					binType: "bool", binOffs: 0, bit: 4,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Boolean", name: "In one Cycle", position: "3",
						formatter: "NULL", defaultval: false
					}
				},
				{
					param: "current", type: "number",
					formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0
				},
				{
					param: "amount", type: "number",
					binType: "number", binOffs: 0, binSize: 1,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Int32", name: "Amount", position: "0",
						formatter: "NULL", minval: 1, maxval: CHAR_MAX, defaultval: 1
					}
				},
				{
					param: "openRegions", type: "list",
					formatter: "regionsreal", parse: "list", separator: "|", minval: 0, maxval: 252, defaultval: []
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			],
			toPaint: function(p) {
				var paint = [
					{ type: "icon", value: this.entityIconAtlas("Pomegranate"), scale: 1, color: this.entityIconColor("Pomegranate"), rotation: 0 },
					{ type: "break" },
					{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
				];
				if (p.differentRegions) {
					paint.splice(1, 0, { type: "icon", value: "TravellerA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
				} else if (p.region !== "Any Region") {
					paint.splice(1, 0,
						{ type: "break" },
						{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
					);
				}
				if (p.oneCycle)
					paint.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
				return paint;
			},
			toDesc: function(p) {
				var d = "Open " + this.entityNameQuantify(p.amount, "Pomegranates");
				if (p.differentRegions)
					d += ", in different regions";
				else if (p.region !== "Any Region")
					d += ", in " + this.regionToDisplayText(this.board.character, p.region);
				if (p.oneCycle)
					d += ", in one cycle";
				return d + ".";
			},
			toComment: function(p) {
				return "";
			},
			toBinary: function(p) {
				var b = Array(5); b.fill(0);
				b[0] = this.challengeValue(p._name);
				Bingovista.applyBool(b, 1, 4, p.oneCycle);
				Bingovista.applyBool(b, 1, 5, p.differentRegions);
				b[3] = p.amount;
				b[4] = this.enumToValue(p.region, "pomegranateregions");
				for (var k = 0; k < p.openRegions.length; k++)
					b.push(this.enumToValue(p.openRegions[k], "regionsreal"));
				b.push(0);
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoSpinningTopChallenge",
			category: "Visiting Spinning Top",
			super: undefined,
			//	desc of format (< v1.2) ["System.Boolean|true|Specific location|0|NULL><System.String|WVWA|Region|1|spinners><System.Boolean|false|While Starving|3|NULL><0><System.Int32|3|Amount|2|NULL><0><0><"]
			//	or (>= v1.2) ["System.Boolean|false|Specific Echo|0|NULL", "System.String|SB|Region|1|echoes", "System.Boolean|true|While Starving|3|NULL", "0", "System.Int32|2|Amount|2|NULL", "0", "0", ""]
			textUpgrade: {
				4: [
					{ op: "unshift", data: ["System.Boolean|true|Specific Echo|0|NULL"] },
					{ op: "splice", offs: 3, rem: 0, data: ["0", "System.Int32|1|Amount|2|NULL"] },
					{ op: "push", data: [""] }
				]
			},
			textDowngrade: {},
			template: [
				{
					param: "specific", type: "bool",
					binType: "bool", binOffs: 0, bit: 5,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Boolean", name: "Specific location", position: "0",
						formatter: "NULL", defaultval: true
					}
				},
				{
					param: "spinner", type: "string",
					binType: "number", binOffs: 0, binSize: 1,
					formatter: "spinners", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Region", position: "1",
						formatter: "spinners", defaultval: "WARF"
					}
				},
				{
					param: "starve", type: "bool",
					binType: "bool", binOffs: 0, bit: 4,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Boolean", name: "While Starving", position: "3",
						formatter: "NULL", defaultval: false
					}
				},
				{
					param: "current", type: "number",
					formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0
				},
				{
					param: "amount", type: "number",
					binType: "number", binOffs: 1, binSize: 1,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Int32", name: "Amount", position: "2",
						formatter: "NULL", minval: 1, maxval: CHAR_MAX, defaultval: 1
					}
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "visited", type: "list",
					formatter: "regionsreal", parse: "list", separator: "|", defaultval: []
				}
			],
			toPaint: function(p) {
				var paint = [
					{ type: "icon", value: "spinningtop", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
					{ type: "break" },
					{ type: "text", value: (p.specific ? p.spinner : "[" + String(p.current) + "/" + String(p.amount) + "]"), color: Bingovista.colors.Unity_white }
				];
				if (p.starve) {
					paint.push(
						{ type: "break" },
						{ type: "icon", value: "MartyrB", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
					);
				}
				return paint;
			},
			toDesc: function(p) {
				return "Visit Spinning Top " + (p.specific ? ("in " + this.regionToDisplayText(this.board.character, p.spinner)) : (p.amount <= 1 ? "once" : String(p.amount) + " times")) + (p.starve ? ", while starving." : ".");
			},
			toComment: function(p) {
				return "";
			},
			toBinary: function(p) {
				var b = Array(5); b.fill(0);
				b[0] = this.challengeValue(p._name);
				Bingovista.applyBool(b, 1, 4, p.starve);
				Bingovista.applyBool(b, 1, 5, p.specific);
				b[3] = this.enumToValue(p.spinner, "spinners");
				b[2] = b.length - GOAL_LENGTH;
				b[4] = p.amount;
				for (var k = 0; k < p.visited.length; k++)
					b.push(this.enumToValue(p.visited[k], "regionsreal"));
				b.push(0);	//	zero terminator
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
		{
			name: "WatcherBingoWeaverChallenge",
			category: "Visiting The Weaver",
			super: undefined,
			//	desc of format ["WMPA", "System.String|WMPA_A07|Portal Room|0|weaverrooms", "0", "0"]
			textUpgrade: {
				4: [	//	Hack to use arbitrary string template
					{ op: "replace", offs: 1, find: "\\|W?weaver[rR]ooms$", replace: "|NULL" }
				]
			},
			textDowngrade: {
				4: [	//	and unhack...
					{ op: "replace", offs: 1, find: "\\|NULL$", replace: "|weaverrooms" }
				]
			},
			template: [
				{
					param: "region", type: "string",
					binType: "number", binOffs: 0, binSize: 1,
					formatter: "regions", parse: "string"
				},
				{
					param: "room", type: "string",
					binType: "string", binOffs: 1, binSize: 0,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Portal Room", position: "0",
						ucase: true, formatter: "NULL", defaultval: "WARA_P22"
					}
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			],
			toPaint: function(p) {
				return [
					{ type: "icon", value: "weaver", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
					{ type: "break" },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
				];
			},
			toDesc: function(p) {
				return "Visit The Weaver in " + this.regionToDisplayText(this.board.character, Bingovista.regionOfRoom(p.room)) + ".";
			},
			toComment: function(p) {
				return "Room: " + this.getMapLink(p.room, this.board.character);
			},
			toBinary: function(p) {
				var b = Array(4); b.fill(0);
				b[0] = this.challengeValue(p._name);
				b[3] = this.enumToValue(p.region, "regions");
				b = b.concat([...new TextEncoder().encode(p.room)]);
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		},
/*
		{
			name: "WatcherBingoTemplateMakingChallenge",
			category: "",
			super: undefined,
			//	desc of format ["", ...]
			textUpgrade: {
				4: [	//	v2.whatever hack: these things changed
					{ op: "intFormat", offs: 3, before: "System.Int32|", after: "|Amount|1|NULL" },
					{ op: "splice", offs: 2, rem: 0, data: ["insert string 1", "insert string 2"] },
					{ op: "push", data: ["new last string"] },
					{ op: "unshift", data: ["new first string"] },
					{ op: "replace", offs: 4, find: "regex body", replace: "replacing text" },
					{ op: "move", from: 4, to: 0 },
				]
			},
			textDowngrade: {},
			};
			const template = [
				{
					param: "weapon", type: "string",
					binType: "number", binOffs: 0,  binSize: 1,
					formatter: "weapons", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Weapon", position: "0",
						formatter: "weapons", defaultval: "Any Weapon"
					}
				},
				{
					param: "victim", type: "string",
					binType: "number", binOffs: 1,  binSize: 1,
					formatter: "creatures", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Creature Type", position: "1",
						formatter: "creatures", defaultval: "Any Creature"
					}
				},
				{
					param: "current", type: "number",
					formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
				},
				{
					param: "amount", type: "number",
					binType: "number", binOffs: 2,  binSize: 2,
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Int32", name: "Amount", position: "2",
						formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
					}
				},
				{
					param: "regionsToEnter", type: "list",
					binType: "string", binOffs: 2, binSize: 0,
					formatter: "regionsreal", parse: "list", separator: "|", minval: 0, maxval: 252, defaultval: []
				},
				{
					param: "inOneCycle", type: "bool",
					formatter: "", parse: "SettingBox", parseFmt: {
						datatype: "System.Boolean", name: "In One Cycle", position: "3",
						formatter: "NULL", defaultval: false
					}
				},
				{
					param: "region", type: "string",
					formatter: "regions", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Region", position: "4",
						formatter: "regions", defaultval: "Any Region"
					}
				},
				{
					param: "subregion", type: "string",
					formatter: "subregions", parse: "SettingBox", parseFmt: {
						datatype: "System.String", name: "Subregion", position: "5",
						formatter: "subregions", defaultval: "Any Subregion"
					}
				},
				{
					param: "completed", type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				},
				{
					param: "revealed",  type: "bool",
					formatter: "", parse: "intBool", defaultval: false
				}
			];
			toPaint: function(p) {
				return [
					{ type: "icon", value: "foodSymbol", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
					{ type: "break" },
					{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
				];
			},
			toDesc: function(p) {
				return "";
			},
			toComment: function(p) {
				return "";
			},
			toBinary: function(p) {
				var b = Array(3); b.fill(0);
				b[0] = this.challengeValue(p._name);
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
		}
*/

		//	Challenge updates via -Ex mechanism
		//	should never be referenced by binary data --> keep these flush to bottom of list
/*
		{
			name: "WatcherBingoAchievementChallenge",
			super: "BingoAchievementChallenge",
			//	WatcherBingoAchievementChallenge~System.String|Hunter|Passage|0|Wpassage><0><0
			//	       BingoAchievementChallenge~System.String|Hunter|Passage|0|passage><0><0
			textUpgrade: {
				3: [
					{ op: "replace", offs: 0, find: "\\|Wpassage$", replace: "|passage" }
				]
			},
			template: []
		}
*/
	]
};

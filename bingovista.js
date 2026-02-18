/*
 *	bingovista.js
 *	RW Bingo Board Viewer JS module
 *	(c) 2025 T3sl4co1l
 *	some more TODOs:
 *	- [DONE] categorize vista points by source (stock = base game; bingo extended = from mod; or other strings from modpacks)
 *	- nudge around board view by a couple pixels to spread out rounding errors
 *	- board server to...basically URL-shorten?
 *	  --> practically done; service is currently active, but no submission portal yet; manual submissions are possible
 *	- ???
 *	- no profit, this is for free GDI
 *	- Streamline challenge parsing? compactify functions? or reduce to structures if possible?
 *	  --> planned for v2.0 but will take a while
 *	  --> slowly in progress; refactoring CHALLENGES first
 *	- Make most class fields and internal methods private
 *	  --> want some usability feedback first: determine which ones are
 *	      worth keeping exposed, and which ones are best for usability
 *
 *	Stretchier goals:
 *	- Board editing, of any sort
 *	    * Drag and drop to move goals around
 *		* Make parameters editable
 *		* Port generator code from C#??
 *
 *	Possible config option: solid icons:
 *	conditional replace "buttonCrossA", "keyShiftA" with "buttonCrossB", "keyShiftB"
 *	--> could make a UI icons (and colors) collection
 */

/*                            *
 * * *  Global Constants  * * *
 *                            */

/**
 *	Maximum accepted value for Int32 challenge parameters. In-game default
 *	seems to be 500; binary format has a hard limit of 32767 (signed) or
 *	65535 (unsigned). Somewhere around 30k seems reasonable enough for a
 *	rounded value?
 */
const INT_MAX  = 30000;
const CHAR_MAX =   250;	/**< Same as INT_MAX, but for challenges *very* unlikely to need >1 byte */
const VERSION_MAJOR   =  2, VERSION_MINOR = 0;	/**< Supported mod version */
const HEADER_LENGTH   = 21;	/**< Binary header length, bytes */
const GOAL_LENGTH     =  3;	/**< Binary goal length, bytes */
const RESP_HEADER_LEN = 34;

/*                           *
 * * *  Class Interface  * * *
 *                           */

class Bingovista {


/*                  *
 * * *  Fields  * * *
 *                  */

//	Configuration and customization
//	TODO: most of these will eventually be private; exposing for debugging purposes
dataSrc; dataType;
headerId; boardId; selectId; detailId;
cursorEnabled = false;
/** Flag to reveal full detail on otherwise-hidden challenges (e.g. Vista Points), and extended commentary */
tipsEnabled = false;
/** Flag to transpose the board (visual compatibility < v1.25) */
transposeEnabled = false;
loadFailureCallbacks = []; loadSuccessCallbacks = [];
selectCallbacks = []; mouseoverCallbacks = [];
resourceTimer = 0;

//	Data sources, modding
/** Response header (binary and decoded) when sourced from shortener URL */
respHeader;
/** Modpacks to extend enums, dictionaries and challenges; array of objects which contain a data source (at init), and the structure (after fetch and parse) */
modpacks = [];
/** Goal definitions; used to convert to/from internal/abstract format (`board`), binary or text format, and accessory outputs (DOM contents); read only (use modding to modify) */
goalDefs = [];
/** Enums used to parse/produce text; dictionary of arrays of strings; read only (use modding to modify) */
enums;
/** Maps converting between respectively named enums, and any characteristics they share (descriptive text, icons, colors, etc.) */
maps;
/** Dictionary of all items and creatures; values: objects containing display text, icon name, and color; read only (use modding to modify) */
entities;
/** Board data, as generated from dataSrc/Type; freely read/writable (run refresh() to update document state) */
board;
/** Base URL of online map viewer, used by getMapLink(); freely read/writable; set to "" to disable linking */
mapLink = "https://noblecat57.github.io/map.html";
/** Base URL to board shortener server; freely read/writable */
shortenerLink = "https://www.seventransistorlabs.com/bserv/BingoServer.dll?q=";
/** Description text when no square is selected; freely read/writable */
unselectText = "Select a square to view details.";

/**
 *	List of sprite atlases, in order of precedence, highest to lowest.
 *	drawIcon() searches this list, in order, for an icon it needs.
 *	These are pre-loaded on startup from the named references, but unnamed or external
 *	references can be added by pushing (least priority), shifting (most), or inserting
 *	(anywhere) more entries.  Make sure `canv` contains a valid canvas of the sprite
 *	sheet, and `frames` contains the collection of sprite names and coordinates, in
 *	common (e.g. texturepacker) JSON format.
 */
atlases = [
	{ img: "atlases/bvicons.png",      txt: "atlases/bvicons.txt",      canv: undefined, frames: undefined, imgErr: "", txtErr: "" },	/**< anything not found below */
	{ img: "atlases/bingoicons.png",   txt: "atlases/bingoicons.txt",   canv: undefined, frames: undefined, imgErr: "", txtErr: "" },	/**< from Bingo mod */
	{ img: "atlases/uispritesmsc.png", txt: "atlases/uispritesmsc.txt", canv: undefined, frames: undefined, imgErr: "", txtErr: "" }, 	/**< from DLC       */
	{ img: "atlases/uiSprites.png",    txt: "atlases/uiSprites.txt",    canv: undefined, frames: undefined, imgErr: "", txtErr: "" } 	/**< from base game */
];

//	Internal state, or convenient calculations
/**
 *	Current selection cursor on the board (click on board, or focus board 
 *	and use arrow keys).  No selection: undefined; selected: { col: <number>, row: <number> }
 *	(col, row are in row-first raster order from TL to BR.)
 */
selected;

/**
 *	Bingo square graphics, default dimensions and other properties.
 *	Read by clickBoard, refreshBoard, selectSquare and setCursor.
 */
square = {
	border: 2,
	radius: 4,
	margin: 6,
	selMargin: 4,
	color: Bingovista.colors.Unity_white,
	background: "#020204",
	font: "600 10pt \"Segoe UI\", sans-serif"
};

/**
 *	Used by entityNameQuantify().  Replaces suffixes of plural
 *	creature/item names with singulars.
 *	Scanned from top to bottom, breaking when a match is found.
 */
pluralReplacers = [
	{ regex: /Long Legs$/, text: "Long Legs" },
	{ regex: /Mice$/,      text: "Mouse"     },
	{ regex: /ies$/,       text: "y"         },
	{ regex: /ches$/,      text: "ch"        },
	{ regex: /Larvae$/,    text: "Larva"     },
	{ regex: /s$/,         text: ""          }
];

/**
 *	Challenge names that have changed across versions.
 *	Used by textToGoal(). Directly substitutes old to new text.
 *	key: old name
 *	value: current name
 *	[absent]: no change
 */
challengeUpgrades = {
	"BingoMoonCloak":            "BingoMoonCloakChallenge",	//	v1.08
	"BingoAllRegionsExcept":     "BingoAllRegionsExceptChallenge",	//	v1.27
	"BingoCycleScoreChallenge":  "BingoScoreChallenge",	//	v1.326
	"BingoGlobalScoreChallenge": "BingoScoreChallenge" 	//	v1.326
};

/**
 *	List of setup options, for reference.  Do not modify (is
 *	never read); if needed, make copy with Object.apply().
 */
static setupOptions = {
	loadFail:    undefined,
	loadSuccess: undefined,
	selectCB:    undefined,
	mouseCB:     undefined,
	selection:   undefined,
	cursor:      undefined,
	transpose:   undefined,
	tips:        undefined,
	dataSrc:     undefined,
	headerId:    undefined,
	boardId:     undefined,
	selectId:    undefined,
	detailId:    undefined
};

/**
 *	Assorted color constants that don't belong
 *	to any particular object, type or class
 *	Key type: internal name
 *	Value type: string, HTML color (7 chars)
 */
static colors = {
	//	RainWorld (global consts?), HSL2RGB'd and mathed as needed
	"AntiGold":            "#3985d5",
	"GoldHSL":             "#d58a39",
	"GoldRGB":             "#875d2f",
	"SaturatedGold":       "#ffba5e",
	"MapColor":            "#61517a",
	//	CollectToken
	"RedColor":            "#ff0000",
	"GreenColor":          "#43d539",
	"WhiteColor":          "#878787",
	"DevColor":            "#dd00f0",
	"TokenDefault":        "#ff990c",	//	BingoUnlockChallenge::IconDataForUnlock "gold" default
	//	PlayerGraphics::DefaultSlugcatColor, prefix with "Slugcat_"
	"Slugcat_White":       "#ffffff",
	"Slugcat_Yellow":      "#ffff73",
	"Slugcat_Red":         "#ff7373",
	"Slugcat_Night":       "#17234e",
	"Slugcat_Sofanthiel":  "#17234f",
	"Slugcat_Rivulet":     "#91ccf0",
	"Slugcat_Artificer":   "#70233c",
	"Slugcat_Saint":       "#aaf156",
	"Slugcat_Spear":       "#4f2e68",
	"Slugcat_Spearmaster": "#4f2e68",	//	avoid special cases detecting "Spear" vs. "Spearmaster"
	"Slugcat_Gourmand":    "#f0c197",
	//	UnityEngine.Color, prefix with "Unity_"
	"Unity_red":           "#ff0000",
	"Unity_green":         "#00ff00",
	"Unity_blue":          "#0000ff",
	"Unity_white":         "#ffffff",
	"Unity_black":         "#000000",
	"Unity_yellow":        "#ffeb04",
	"Unity_cyan":          "#00ffff",
	"Unity_magenta":       "#ff00ff",
	"Unity_gray":          "#808080",
	"Unity_grey":          "#808080",
	//	Hard-coded Bingo and Expedition colors
	"ExpHidden":           "#ffc019",
	"GuidanceNeuron":      "#00ff4c",
	"GuidanceMoon":        "#ffcc4c",
	"nomscpebble":         "#72e6c4",
	"EnterFrom":           "#4287ff"
};

/**
 *	Example / template shortener response header
 */
static respHeader = {
	action: ["DB_INFO_PREV_AVAILABLE", "DB_INFO_NEXT_AVAILABLE", "DB_INFO_NO_MOVE"],
	created: new Date(0),
	error: "",
	key: "",
	raw: [],
	status: ["BIN_RESP_OK", "BIN_RESP_NOT_FOUND", "BIN_RESP_NO_KEY", "BIN_RESP_ERROR", "BIN_RESP_UNKNOWN"],
	views: 0
};


/*                       *
* * *  Constructor  * * *
*                       */

constructor(params) {

	//	Make methods this'd
	//Bingovista.applyBool               = Bingovista.applyBool.bind(this);
	this.areResourcesDone        = this.areResourcesDone.bind(this);
	//this.binToGoal           = this.binToGoal.bind(this);
	//this.binToBoard              = this.binToBoard.bind(this);
	//this.boardToBin              = this.boardToBin.bind(this);
	//this.challengeTextToAbstract = this.challengeTextToAbstract.bind(this);
	//this.checkSettingBoxEx       = this.checkSettingBoxEx.bind(this);
	this.clickBoard              = this.clickBoard.bind(this);
	this.clickShowPerks          = this.clickShowPerks.bind(this);
	//this.drawIcon                = this.drawIcon.bind(this);
	//this.drawSquare              = this.drawSquare.bind(this);
	//this.entityDisplayText       = this.entityDisplayText.bind(this);
	//this.entityIconAtlas         = this.entityIconAtlas.bind(this);
	//this.entityIconColor         = this.entityIconColor.bind(this);
	//this.entityNameQuantify      = this.entityNameQuantify.bind(this);
	//this.enumToValue             = this.enumToValue.bind(this);
	//this.errorBoard              = this.errorBoard.bind(this);
	//this.getBoardSquareFromCoord = this.getBoardSquareFromCoord.bind(this);
	//this.getBoardSquareOrigin    = this.getBoardSquareOrigin.bind(this);
	//this.getBoardSquareOriginIdx = this.getBoardSquareOriginIdx.bind(this);
	//this.getBoardSquareSize      = this.getBoardSquareSize.bind(this);
	//this.getGoal                 = this.getGoal.bind(this);
	//this.getMapLink              = this.getMapLink.bind(this);
	//this.identifyModpack         = this.identifyModpack.bind(this);
	//this.loadAtlas               = this.loadAtlas.bind(this);
	this.mouseBoard              = this.mouseBoard.bind(this);
	this.mouseEventToSquare      = this.mouseEventToSquare.bind(this);
	this.mouseleaveBoard         = this.mouseleaveBoard.bind(this);
	//this.parseText               = this.parseText.bind(this);
	//this.refresh                 = this.refresh.bind(this);
	//this.refreshBoard            = this.refreshBoard.bind(this);
	//this.refreshHeader           = this.refreshHeader.bind(this);
	//this.regionToDisplayText     = this.regionToDisplayText.bind(this);
	//this.resourceCallback        = this.resourceCallback.bind(this);
	//this.selectSquare            = this.selectSquare.bind(this);
	//this.setCursor               = this.setCursor.bind(this);
	//this.setup                   = this.setup.bind(this);
	//this.toString                = this.toString.bind(this);
	//this.validateQuery           = this.validateQuery.bind(this);

	//	Make all the maps and enums needed in the instance
	this.maps = {};
	this.maps.characters = [
		{ name: "Yellow",     text: "Monk",        color: "#ffff73", icon: "Kill_Slugcat" },
		{ name: "White",      text: "Survivor",    color: "#ffffff", icon: "Kill_Slugcat" },
		{ name: "Red",        text: "Hunter",      color: "#ff7373", icon: "Kill_Slugcat" },
		{ name: "Gourmand",   text: "Gourmand",    color: "#f0c197", icon: "Kill_Slugcat" },
		{ name: "Artificer",  text: "Artificer",   color: "#70233c", icon: "Kill_Slugcat" },
		{ name: "Rivulet",    text: "Rivulet",     color: "#91ccf0", icon: "Kill_Slugcat" },
		{ name: "Spear",      text: "Spearmaster", color: "#4f2e68", icon: "Kill_Slugcat" },
		{ name: "Saint",      text: "Saint",       color: "#aaf156", icon: "Kill_Slugcat" },
		{ name: "Sofanthiel", text: "Inv",         color: "#17234f", icon: "Kill_Slugcat" },
		{ name: "Night",      text: "Nightcat",    color: "#17234e", icon: "Kill_Slugcat" }
	];
	this.maps.chatlogs = [
		//	Base from Bingo Mod extract; colors from Wiki
		{ name: "Chatlog_CC0",        room: "CC_C11",      region: "CC", color: "#d48573" },
		{ name: "Chatlog_DS0",        room: "DS_A19",      region: "DS", color: "#247d45" },
		{ name: "Chatlog_HI0",        room: "HI_A18",      region: "HI", color: "#667ad1" },
		{ name: "Chatlog_GW0",        room: "GW_D01_PAST", region: "GW", color: "#cce370" },
		{ name: "Chatlog_GW2",        room: "GW_C04_PAST", region: "GW", color: "#cce370" },
		{ name: "Chatlog_GW1",        room: "GW_E02_PAST", region: "GW", color: "#cce370" },
		{ name: "Chatlog_SI2",        room: "SI_B02",      region: "SI", color: "#e8597f" },
		{ name: "Chatlog_SI5",        room: "SI_B12",      region: "SI", color: "#e8597f" },
		{ name: "Chatlog_SI3",        room: "SI_C07",      region: "SI", color: "#e8597f" },
		{ name: "Chatlog_SI4",        room: "SI_D05",      region: "SI", color: "#e8597f" },
		{ name: "Chatlog_SI0",        room: "SI_A07",      region: "SI", color: "#e8597f" },
		{ name: "Chatlog_SI1",        room: "SI_A07",      region: "SI", color: "#e8597f" },
		{ name: "Chatlog_SH0",        room: "SH_E05",      region: "SH", color: "#593699" },
		{ name: "Chatlog_SB0",        room: "SB_F03",      region: "SB", color: "#9c5933" },
		{ name: "Chatlog_LM0",        room: "LM_B04",      region: "LM", color: "#30bab2" },
		{ name: "Chatlog_LM1",        room: "LM_TOWER02",  region: "LM", color: "#30bab2" },
		{ name: "Chatlog_DM1",        room: "DM_U07",      region: "DM", color: "#194fe7" },
		{ name: "Chatlog_DM0",        room: "DM_WALL06",   region: "DM", color: "#194fe7" },
		//	extended, in case they get implemented; sourced from noblecat57 interactive map
		{ name: "Chatlog_Broadcast0", room: "UW_J01",      region: "UW", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast1", room: "SS_D08",      region: "SS", color: Bingovista.colors.WhiteColor },
		//	"Broadcast1" appears twice in the level data; special case: select "Broadcast1" then add 0 or 1 to the index to get the SS or LM one
		{ name: "Chatlog_Broadcast1", room: "LM_EDGE02",   region: "LM", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast2", room: "SU_A17",      region: "SU", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast3", room: "SH_B03",      region: "SH", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast4", room: "SB_C07",      region: "SB", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast5", room: "HI_B02",      region: "HI", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast6", room: "LF_D01",      region: "LF", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast7", room: "DS_A11",      region: "DS", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast8", room: "VS_B10",      region: "VS", color: Bingovista.colors.WhiteColor },
		{ name: "Chatlog_Broadcast9", room: "VS_A05",      region: "VS", color: Bingovista.colors.WhiteColor }
	];
	this.maps.creatures = [
		{ name: "Any Creature",    text: "Any Creatures",        icon: "Futile_White",         color: "#a9a4b2" },
		{ name: "Slugcat",         text: "Slugcats",             icon: "Kill_Slugcat",         color: "#ffffff" },
		{ name: "GreenLizard",     text: "Green Lizards",        icon: "Kill_Green_Lizard",    color: "#33ff00" },
		{ name: "PinkLizard",      text: "Pink Lizards",         icon: "Kill_Standard_Lizard", color: "#ff00ff" },
		{ name: "BlueLizard",      text: "Blue Lizards",         icon: "Kill_Standard_Lizard", color: "#0080ff" },
		{ name: "CyanLizard",      text: "Cyan Lizards",         icon: "Kill_Standard_Lizard", color: "#00e8e6" },
		{ name: "RedLizard",       text: "Red Lizards",          icon: "Kill_Standard_Lizard", color: "#e60e0e" },
		{ name: "WhiteLizard",     text: "White Lizards",        icon: "Kill_White_Lizard",    color: "#ffffff" },
		{ name: "BlackLizard",     text: "Black Lizards",        icon: "Kill_Black_Lizard",    color: "#5e5e6f" },
		{ name: "YellowLizard",    text: "Yellow Lizards",       icon: "Kill_Yellow_Lizard",   color: "#ff9900" },
		{ name: "Salamander",      text: "Salamanders",          icon: "Kill_Salamander",      color: "#eec7e4" },
		{ name: "Scavenger",       text: "Scavengers",           icon: "Kill_Scavenger",       color: "#a9a4b2" },
		{ name: "Vulture",         text: "Vultures",             icon: "Kill_Vulture",         color: "#d4ca6f" },
		{ name: "KingVulture",     text: "King Vultures",        icon: "Kill_KingVulture",     color: "#d4ca6f" },
		{ name: "CicadaA",         text: "White Squidcadas",     icon: "Kill_Cicada",          color: "#ffffff" },
		{ name: "CicadaB",         text: "Black Squidcadas",     icon: "Kill_Cicada",          color: "#5e5e6f" },
		{ name: "Snail",           text: "Snails",               icon: "Kill_Snail",           color: "#a9a4b2" },
		{ name: "Centiwing",       text: "Centiwings",           icon: "Kill_Centiwing",       color: "#0eb23c" },
		{ name: "SmallCentipede",  text: "Small Centipedes",     icon: "Kill_Centipede1",      color: "#ff9900" },
		{ name: "Centipede",       text: "Large Centipedes",     icon: "Kill_Centipede2",      color: "#ff9900" },
		{ name: "BigCentipede",    text: "Overgrown Centipedes", icon: "Kill_Centipede3",      color: "#ff9900" },
		{ name: "RedCentipede",    text: "Red Centipedes",       icon: "Kill_Centipede3",      color: "#e60e0e" },
		{ name: "BrotherLongLegs", text: "Brother Long Legs",    icon: "Kill_Daddy",           color: "#74864e" },
		{ name: "DaddyLongLegs",   text: "Daddy Long Legs",      icon: "Kill_Daddy",           color: "#0000ff" },
		{ name: "LanternMouse",    text: "Lantern Mice",         icon: "Kill_Mouse",           color: "#a9a4b2" },
		{ name: "GarbageWorm",     text: "Garbage Worms",        icon: "Kill_Garbageworm",     color: "#a9a4b2" },
		{ name: "Fly",             text: "Batflies",             icon: "Kill_Bat",             color: "#a9a4b2" },
		{ name: "Leech",           text: "Leeches",              icon: "Kill_Leech",           color: "#ae281e" },
		{ name: "SeaLeech",        text: "Sea Leeches",          icon: "Kill_Leech",           color: "#0c4cb3" },
		{ name: "JetFish",         text: "Jetfish",              icon: "Kill_Jetfish",         color: "#a9a4b2" },
		{ name: "BigEel",          text: "Leviathans",           icon: "Kill_BigEel",          color: "#a9a4b2" },
		{ name: "Deer",            text: "Rain Deer",            icon: "Kill_RainDeer",        color: "#a9a4b2" },
		{ name: "TubeWorm",        text: "Tube Worms",           icon: "Kill_Tubeworm",        color: "#0c4cb3" },
		{ name: "Spider",          text: "Coalescipedes",        icon: "Kill_SmallSpider",     color: "#a9a4b2" },
		{ name: "BigSpider",       text: "Large Spiders",        icon: "Kill_BigSpider",       color: "#a9a4b2" },
		{ name: "SpitterSpider",   text: "Spitter Spiders",      icon: "Kill_BigSpider",       color: "#ae281e" },
		{ name: "MirosBird",       text: "Miros Birds",          icon: "Kill_MirosBird",       color: "#a9a4b2" },
		{ name: "TentaclePlant",   text: "Monster Kelp",         icon: "Kill_TentaclePlant",   color: "#a9a4b2" },
		{ name: "PoleMimic",       text: "Pole Mimics",          icon: "Kill_PoleMimic",       color: "#a9a4b2" },
		{ name: "Overseer",        text: "Overseers",            icon: "Kill_Overseer",        color: "#00e8e6" },
		{ name: "VultureGrub",     text: "Vulture Grubs",        icon: "Kill_VultureGrub",     color: "#d4ca6f" },
		{ name: "EggBug",          text: "Egg Bugs",             icon: "Kill_EggBug",          color: "#00ff78" },
		{ name: "BigNeedleWorm",   text: "Large Noodleflies",    icon: "Kill_NeedleWorm",      color: "#ff9898" },
		{ name: "SmallNeedleWorm", text: "Baby Noodleflies",     icon: "Kill_SmallNeedleWorm", color: "#ff9898" },
		{ name: "DropBug",         text: "Dropwigs",             icon: "Kill_DropBug",         color: "#a9a4b2" },
		{ name: "Hazer",           text: "Hazers",               icon: "Kill_Hazer",           color: "#36ca63" },
		{ name: "TrainLizard",     text: "Train Lizards",        icon: "Kill_Standard_Lizard", color: "#4c00ff" },
		{ name: "ZoopLizard",      text: "Strawberry Lizards",   icon: "Kill_White_Lizard",    color: "#f3baba" },
		{ name: "EelLizard",       text: "Eel Lizards",          icon: "Kill_Salamander",      color: "#05c733" },
		{ name: "JungleLeech",     text: "Jungle Leeches",       icon: "Kill_Leech",           color: "#19b319" },
		{ name: "TerrorLongLegs",  text: "Terror Long Legs",     icon: "Kill_Daddy",           color: "#4c00ff" },
		{ name: "MotherSpider",    text: "Mother Spiders",       icon: "Kill_BigSpider",       color: "#19b319" },
		{ name: "StowawayBug",     text: "Stowaway Bugs",        icon: "Kill_Stowaway",        color: "#5e5e6f" },
		{ name: "HunterDaddy",     text: "Hunter Long Legs",     icon: "Kill_Slugcat",         color: "#cc7878" },
		{ name: "FireBug",         text: "Firebugs",             icon: "Kill_FireBug",         color: "#ff7878" },
		{ name: "AquaCenti",       text: "Aquapedes",            icon: "Kill_Centiwing",       color: "#0000ff" },
		{ name: "MirosVulture",    text: "Miros Vultures",       icon: "Kill_MirosBird",       color: "#e60e0e" },
		{ name: "ScavengerElite",  text: "Elite Scavengers",     icon: "Kill_ScavengerElite",  color: "#a9a4b2" },
		{ name: "ScavengerKing",   text: "King Scavengers",      icon: "Kill_ScavengerKing",   color: "#a9a4b2" },
		{ name: "SpitLizard",      text: "Caramel Lizards",      icon: "Kill_Spit_Lizard",     color: "#8c6633" },
		{ name: "Inspector",       text: "Inspectors",           icon: "Kill_Inspector",       color: "#72e6c4" },
		{ name: "Yeek",            text: "Yeeks",                icon: "Kill_Yeek",            color: "#e6e6e6" },
		{ name: "BigJelly",        text: "Large Jellyfish",      icon: "Kill_BigJellyFish",    color: "#ffd9b3" },
		{ name: "SlugNPC",         text: "Slugpups",             icon: "Kill_Slugcat",         color: "#a9a4b2" },
		{ name: "Default",         text: "Unknown Creatures",    icon: "Futile_White",         color: "#a9a4b2" }
	];
	/**
	 *	Expedition flags data; internal name and bit value from format.txt.
	 *	Titles from in-game (give or take).
	 *	Perk and burden group names: see Expedition.ExpeditionProgression
	 */
	this.maps.expflags = [
		{ name: "LANTERN",   value: 0x00000001, title: "Perk: Scavenger Lantern",    group: "unl-lantern"           },
		{ name: "MASK",      value: 0x00000002, title: "Perk: Vulture Mask",         group: "unl-vulture"           },
		{ name: "BOMB",      value: 0x00000004, title: "Perk: Scavenger Bomb",       group: "unl-bomb"              },
		{ name: "NEURON",    value: 0x00000008, title: "Perk: Neuron Glow",          group: "unl-glow"              },
		{ name: "BACKSPEAR", value: 0x00000010, title: "Perk: Back Spear",           group: "unl-backspear"         },
		{ name: "FLOWER",    value: 0x00000020, title: "Perk: Karma Flower",         group: "unl-karma"             },
		{ name: "PASSAGE",   value: 0x00000040, title: "Perk: Enable Passages",      group: "unl-passage"           },
		{ name: "SLOWTIME",  value: 0x00000080, title: "Perk: Slow Time",            group: "unl-slow"              },
		{ name: "SINGUBOMB", value: 0x00000100, title: "Perk: Singularity Bomb",     group: "unl-sing"              },
		{ name: "ELECSPEAR", value: 0x00000200, title: "Perk: Electric Spear",       group: "unl-electric"          },
		{ name: "DUALWIELD", value: 0x00000400, title: "Perk: Spear Dual-Wielding",  group: "unl-dualwield"         },
		{ name: "EXPRESIST", value: 0x00000800, title: "Perk: Explosion Resistance", group: "unl-explosionimmunity" },
		{ name: "EXPJUMP",   value: 0x00001000, title: "Perk: Explosive Jump",       group: "unl-explosivejump"     },
		{ name: "CRAFTING",  value: 0x00002000, title: "Perk: Item Crafting",        group: "unl-crafting"          },
		{ name: "AGILITY",   value: 0x00004000, title: "Perk: High Agility",         group: "unl-agility"           },
		{ name: "RIFLE",     value: 0x00008000, title: "Perk: Joke Rifle",           group: "unl-gun"               },
		{ name: "BLINDED",   value: 0x00010000, title: "Burden: Blinded",            group: "bur-blinded"           },
		{ name: "DOOMED",    value: 0x00020000, title: "Burden: Doomed",             group: "bur-doomed"            },
		{ name: "HUNTED",    value: 0x00040000, title: "Burden: Hunted",             group: "bur-hunted"            },
		{ name: "PURSUED",   value: 0x00080000, title: "Burden: Pursued",            group: "bur-pursued"           },
		{ name: "AURA",      value: 0x00100000, title: "Aura Enabled",               group: "egg"                   },
		{ name: "LOCKOUT",   value: 0x00200000, title: "Gameplay: Lockout",          group: "bing-lockout"          },
		{ name: "BLACKOUT",  value: 0x00400000, title: "Gameplay: Blackout",         group: "bing-blackout"         }
	];
	this.maps.items = [
		{ name: "FirecrackerPlant", text: "Firecracker Plants", icon: "Symbol_Firecracker",    color: "#ae281e" },
		{ name: "FlareBomb",        text: "Flare Bombs",        icon: "Symbol_FlashBomb",      color: "#bbaeff" },
		{ name: "FlyLure",          text: "Fly Lures",          icon: "Symbol_FlyLure",        color: "#ad4436" },
		{ name: "JellyFish",        text: "Jellyfish",          icon: "Symbol_JellyFish",      color: "#a9a4b2" },
		{ name: "Lantern",          text: "Scavenger Lanterns", icon: "Symbol_Lantern",        color: "#ff9251" },
		{ name: "Mushroom",         text: "Mushrooms",          icon: "Symbol_Mushroom",       color: "#ffffff" },
		{ name: "PuffBall",         text: "Puff Balls",         icon: "Symbol_PuffBall",       color: "#a9a4b2" },
		{ name: "ScavengerBomb",    text: "Scavenger Bombs",    icon: "Symbol_StunBomb",       color: "#e60e0e" },
		{ name: "VultureMask",      text: "Vulture Masks",      icon: "Kill_Vulture",          color: "#a9a4b2" },
		{ name: "VultureMask1",     text: "King Vulture Masks", icon: "Kill_KingVulture",      color: "#a9a4b2" },
		{ name: "VultureMask2",     text: "Chieftan Masks",     icon: "Symbol_ChieftainMask",  color: "#a9a4b2" },
		{ name: "Spear",            text: "Spears",             icon: "Symbol_Spear",          color: "#a9a4b2" },
		{ name: "Spear1",           text: "Explosive Spears",   icon: "Symbol_FireSpear",      color: "#e60e0e" },
		{ name: "Spear2",           text: "Electric Spears",    icon: "Symbol_ElectricSpear",  color: "#0000ff" },
		{ name: "Spear3",           text: "Fire Spears",        icon: "Symbol_HellSpear",      color: "#ff7878" },
		{ name: "Rock",             text: "Rocks",              icon: "Symbol_Rock",           color: "#a9a4b2" },
		{ name: "SporePlant",       text: "Bee Hives",          icon: "Symbol_SporePlant",     color: "#ae281e" },
		{ name: "DataPearl",        text: "Pearls",             icon: "Symbol_Pearl",          color: "#b3b3b3" },
		{ name: "DangleFruit",      text: "Blue Fruit",         icon: "Symbol_DangleFruit",    color: "#0000ff" },
		{ name: "EggBugEgg",        text: "Eggbug Eggs",        icon: "Symbol_EggBugEgg",      color: "#00ff78" },
		{ name: "WaterNut",         text: "Bubble Fruit",       icon: "Symbol_WaterNut",       color: "#0c4cb3" },
		{ name: "SlimeMold",        text: "Slime Mold",         icon: "Symbol_SlimeMold",      color: "#ff9900" },
		{ name: "BubbleGrass",      text: "Bubble Grass",       icon: "Symbol_BubbleGrass",    color: "#0eb23c" },
		{ name: "GlowWeed",         text: "Glow Weed",          icon: "Symbol_GlowWeed",       color: "#f2ff44" },
		{ name: "DandelionPeach",   text: "Dandelion Peaches",  icon: "Symbol_DandelionPeach", color: "#97c7f5" },
		{ name: "LillyPuck",        text: "Lillypucks",         icon: "Symbol_LillyPuck",      color: "#2bf6ff" },
		{ name: "GooieDuck",        text: "Gooieducks",         icon: "Symbol_GooieDuck",      color: "#72e6c4" },
		{ name: "NeedleEgg",        text: "Noodlefly Eggs",     icon: "needleEggSymbol",       color: "#932940" },
		{ name: "OverseerCarcass",  text: "Overseer Eyes",      icon: "Kill_Overseer",         color: "#a9a4b2" },
		{ name: "KarmaFlower",      text: "Karma Flowers",      icon: "karmaflower",           color: "#ffba5e" },
		{ name: "ElectricSpear",    text: "Electric Spears",    icon: "Symbol_ElectricSpear",  color: "#0000ff" },
		{ name: "FireSpear",        text: "Fire Spears",        icon: "Symbol_FireSpear",      color: "#e60e0e" },
		{ name: "Pearl",            text: "Pearls",             icon: "Symbol_Pearl",          color: "#b3b3b3" },
		{ name: "SLOracleSwarmer",  text: "Neuron Flies",       icon: "Symbol_Neuron",         color: "#a9a4b2" },
		{ name: "SSOracleSwarmer",  text: "Neuron Flies",       icon: "Symbol_Neuron",         color: "#ffffff" },
		{ name: "NSHSwarmer",       text: "Green Neuron Flies", icon: "Symbol_Neuron",         color: "#00ff4c" },
		{ name: "PebblesPearl",     text: "Pearls",             icon: "Symbol_Pearl",          color: "#0074a3" },
		{ name: "HalcyonPearl",     text: "Pearls",             icon: "Symbol_Pearl",          color: "#b3b3b3" },
		{ name: "Spearmasterpearl", text: "Pearls",             icon: "Symbol_Pearl",          color: "#88282f" },
		{ name: "EnergyCell",       text: "Rarefaction Cells",  icon: "Symbol_EnergyCell",     color: "#05a5d9" },
		{ name: "SingularityBomb",  text: "Singularity Bombs",  icon: "Symbol_Singularity",    color: "#05a5d9" },
		{ name: "MoonCloak",        text: "Moon's Cloak",       icon: "Symbol_MoonCloak",      color: "#f3fff5" },
		{ name: "FireEgg",          text: "Firebug Eggs",       icon: "Symbol_FireEgg",        color: "#ff7878" },
		{ name: "JokeRifle",        text: "Joke Rifles",        icon: "Symbol_JokeRifle",      color: "#a9a4b2" },
		{ name: "Seed",             text: "Popcorn Seeds",      icon: "Symbol_Seed",           color: "#a9a4b2" },
		{ name: "Default",          text: "Unknown Creatures",  icon: "Futile_White",          color: "#a9a4b2" },
		{ name: "SeedCob",          text: "Popcorn Plants",     icon: "popcorn_plant",         color: "#ae281e" },
		{ name: "ExplosiveSpear",   text: "Explosive Spears",   icon: "Symbol_FireSpear",      color: "#ff7878" }
	];
	this.maps.iterators = [
		{ name: "true",    text: "Looks To The Moon", icon: "GuidanceMoon", color: Bingovista.colors.GuidanceMoon },
		{ name: "false",   text: "Five Pebbles",      icon: "nomscpebble",  color: Bingovista.colors.nomscpebble  },
		{ name: "moon",    text: "Looks To The Moon", icon: "GuidanceMoon", color: Bingovista.colors.GuidanceMoon },
		{ name: "pebbles", text: "Five Pebbles",      icon: "nomscpebble",  color: Bingovista.colors.nomscpebble  }
	];
	this.maps.passage = [
		{ name: "Survivor",     text: "The Survivor",      icon: "SurvivorA"     },
		{ name: "Hunter",       text: "The Hunter",        icon: "HunterA"       },
		{ name: "Saint",        text: "The Saint",         icon: "SaintA"        },
		{ name: "Traveller",    text: "The Wanderer",      icon: "TravellerA"    },
		{ name: "Chieftain",    text: "The Chieftain",     icon: "ChieftainA"    },
		{ name: "Monk",         text: "The Monk",          icon: "MonkA"         },
		{ name: "Outlaw",       text: "The Outlaw",        icon: "OutlawA"       },
		{ name: "DragonSlayer", text: "The Dragon Slayer", icon: "DragonSlayerA" },
		{ name: "Scholar",      text: "The Scholar",       icon: "ScholarA"      },
		{ name: "Friend",       text: "The Friend",        icon: "FriendA"       },
		{ name: "Nomad",        text: "The Nomad",         icon: "NomadA"        },
		{ name: "Martyr",       text: "The Martyr",        icon: "MartyrA"       },
		{ name: "Pilgrim",      text: "The Pilgrim",       icon: "PilgrimA"      },
		{ name: "Mother",       text: "The Mother",        icon: "MotherA"       }
	];
	this.maps.pearls = [
		{ name: "Misc",             text: "Misc",             region: "UNKNOWN", maincolor: "#b3b3b3", highlight: undefined, color: "#bebebe" },
		{ name: "Misc2",            text: "Misc 2",           region: "UNKNOWN", maincolor: "#ff99e6", highlight: "#ffffff", color: "#bebebe" },
		{ name: "CC",               text: "Gold",             region: "CC",      maincolor: "#e69919", highlight: "#ffff00", color: "#f3cc19" },
		{ name: "SI_west",          text: "Dark Green",       region: "SI",      maincolor: "#020202", highlight: "#199966", color: "#0d412c" },
		{ name: "SI_top",           text: "Dark Blue",        region: "SI",      maincolor: "#020202", highlight: "#196699", color: "#0d2c41" },
		{ name: "LF_west",          text: "Deep Pink",        region: "LF",      maincolor: "#ff004c", highlight: undefined, color: "#ff2667" },
		{ name: "LF_bottom",        text: "Bright Red",       region: "LF",      maincolor: "#ff1919", highlight: undefined, color: "#ff3c3c" },
		{ name: "HI",               text: "Bright Blue",      region: "HI",      maincolor: "#0232ff", highlight: "#80ccff", color: "#215bff" },
		{ name: "SH",               text: "Deep Magenta",     region: "SH",      maincolor: "#330019", highlight: "#ff3399", color: "#851450" },
		{ name: "DS",               text: "Bright Green",     region: "DS",      maincolor: "#00b319", highlight: undefined, color: "#26be3c" },
		{ name: "SB_filtration",    text: "Teal",             region: "SB",      maincolor: "#198080", highlight: undefined, color: "#3c9393" },
		{ name: "SB_ravine",        text: "Dark Magenta",     region: "SB",      maincolor: "#020202", highlight: "#991966", color: "#410d2c" },
		{ name: "GW",               text: "Viridian",         region: "GW",      maincolor: "#00b380", highlight: "#80ff80", color: "#20c690" },
		{ name: "SL_bridge",        text: "Bright Purple",    region: "SL",      maincolor: "#6619e6", highlight: "#ff66ff", color: "#9435ee" },
		{ name: "SL_moon",          text: "Pale Yellow",      region: "SL",      maincolor: "#e6f333", highlight: undefined, color: "#eaf551" },
		{ name: "SU",               text: "Light Blue",       region: "SU",      maincolor: "#8099e6", highlight: undefined, color: "#93a8ea" },
		{ name: "UW",               text: "Pale Green",       region: "UW",      maincolor: "#669966", highlight: "#ffb3ff", color: "#7da47d" },
		{ name: "PebblesPearl",     text: "Active Processes", region: "UNKNOWN", maincolor: "#b3b3b3", highlight: undefined, color: "#bebebe" },
		{ name: "SL_chimney",       text: "Bright Magenta",   region: "SL",      maincolor: "#ff008c", highlight: "#cc4cff", color: "#ff1ab5" },
		{ name: "Red_stomach",      text: "Aquamarine",       region: "UNKNOWN", maincolor: "#99ffe6", highlight: "#ffffff", color: "#99ffe6" },
		{ name: "Spearmasterpearl", text: "Dark Red",         region: "UNKNOWN", maincolor: "#0a020a", highlight: "#f30000", color: "#7e020a" },
		{ name: "SU_filt",          text: "Light Pink",       region: "SU",      maincolor: "#ffc0e6", highlight: undefined, color: "#ffc9ea" },
		{ name: "SI_chat3",         text: "Dark Purple",      region: "SI",      maincolor: "#020202", highlight: "#661999", color: "#2c0d41" },
		{ name: "SI_chat4",         text: "Olive Green",      region: "SI",      maincolor: "#020202", highlight: "#669919", color: "#2c410d" },
		{ name: "SI_chat5",         text: "Dark Magenta",     region: "SI",      maincolor: "#020202", highlight: "#991966", color: "#410d2c" },
		{ name: "DM",               text: "Light Yellow",     region: "MS",      maincolor: "#f4eb35", highlight: undefined, color: "#f6ee53" },
		{ name: "LC",               text: "Deep Green",       region: "LC",      maincolor: "#006604", highlight: undefined, color: "#267d29" },
		{ name: "OE",               text: "Light Purple",     region: "OE",      maincolor: "#8c5ecc", highlight: undefined, color: "#9d76d4" },
		{ name: "MS",               text: "Dull Yellow",      region: "GW",      maincolor: "#d0e445", highlight: undefined, color: "#d7e861" },
		{ name: "RM",               text: "Music",            region: "RM",      maincolor: "#622ffb", highlight: "#ff0000", color: "#b12ffb" },
		{ name: "Rivulet_stomach",  text: "Celadon",          region: "UNKNOWN", maincolor: "#96dea0", highlight: undefined, color: "#a6e3ae" },
		{ name: "LC_second",        text: "Bronze",           region: "LC",      maincolor: "#990000", highlight: "#cccc00", color: "#c26600" },
		{ name: "CL",               text: "Music (faded)",    region: "CL",      maincolor: "#7b48ff", highlight: "#ff0000", color: "#bd48ff" },
		{ name: "VS",               text: "Deep Purple",      region: "VS",      maincolor: "#870ceb", highlight: "#ff00ff", color: "#c30cf5" },
		{ name: "BroadcastMisc",    text: "Broadcast",        region: "UNKNOWN", maincolor: "#e6b3cc", highlight: "#66e666", color: "#e9c6d2" }
	];
	this.maps.regions = [
		{ code: "Any Region", text: "Any Region",    saintText: undefined           },
		{ code: "CC",   text: "Chimney Canopy",      saintText: "Solitary Towers"   },
		{ code: "CL",   text: undefined,             saintText: "Silent Construct"  },
		{ code: "DM",   text: "Looks to the Moon",   saintText: undefined           },
		{ code: "DS",   text: "Drainage System",     saintText: undefined           },
		{ code: "GW",   text: "Garbage Wastes",      saintText: "Glacial Wasteland" },
		{ code: "HI",   text: "Industrial Complex",  saintText: "Icy Monument"      },
		{ code: "HR",   text: undefined,             saintText: "Rubicon"           },
		{ code: "LC",   text: "Metropolis",          saintText: undefined           },
		{ code: "LF",   text: "Farm Arrays",         saintText: "Desolate Fields"   },
		{ code: "LM",   text: "Waterfront Facility", saintText: undefined           },
		{ code: "MS",   text: "Submerged Superstructure", saintText: undefined      },
		{ code: "OE",   text: "Outer Expanse",       saintText: undefined           },
		{ code: "RM",   text: "The Rot",             saintText: undefined           },
		{ code: "SB",   text: "Subterranean",        saintText: "Primordial Underground" },
		{ code: "SH",   text: "Shaded Citadel",      saintText: undefined           },
		{ code: "SI",   text: "Sky Islands",         saintText: "Windswept Spires"  },
		{ code: "SL",   text: "Shoreline",           saintText: "Frigid Coast"      },
		{ code: "SS",   text: "Five Pebbles",        saintText: undefined           },
		{ code: "SU",   text: "Outskirts",           saintText: "Suburban Drifts"   },
		{ code: "UG",   text: undefined,             saintText: "Undergrowth"       },
		{ code: "UW",   text: "The Exterior",        saintText: undefined           },
		{ code: "VS",   text: "Pipeyard",            saintText: "Barren Conduits"   }
	];
	//	unlocks handled below for brevity
	this.maps.vistas = [
		//	Base Expedition
		{ region: "CC", room: "CC_A10",         x:  734, y:  506 },
		{ region: "CC", room: "CC_B12",         x:  455, y: 1383 },
		{ region: "CC", room: "CC_C05",         x:  449, y: 2330 },
		{ region: "CL", room: "CL_C05",         x:  540, y: 1213 },
		{ region: "CL", room: "CL_H02",         x: 2407, y: 1649 },
		{ region: "CL", room: "CL_CORE",        x:  471, y:  373 },
		{ region: "DM", room: "DM_LAB1",        x:  486, y:  324 },
		{ region: "DM", room: "DM_LEG06",       x:  400, y:  388 },
		{ region: "DM", room: "DM_O02",         x: 2180, y: 2175 },
		{ region: "DS", room: "DS_A05",         x:  172, y:  490 },
		{ region: "DS", room: "DS_A19",         x:  467, y:  545 },
		{ region: "DS", room: "DS_C02",         x:  541, y: 1305 },
		{ region: "GW", room: "GW_C09",         x:  607, y:  595 },
		{ region: "GW", room: "GW_D01",         x: 1603, y:  595 },
		{ region: "GW", room: "GW_E02",         x: 2608, y:  621 },
		{ region: "HI", room: "HI_B04",         x:  214, y:  615 },
		{ region: "HI", room: "HI_C04",         x:  800, y:  768 },
		{ region: "HI", room: "HI_D01",         x: 1765, y:  655 },
		{ region: "LC", room: "LC_FINAL",       x: 2700, y:  500 },
		{ region: "LC", room: "LC_SUBWAY01",    x: 1693, y:  564 },
		{ region: "LC", room: "LC_tallestconnection", x:  153, y:  242 },
		{ region: "LF", room: "LF_A10",         x:  421, y:  412 },
		{ region: "LF", room: "LF_C01",         x: 2792, y:  423 },
		{ region: "LF", room: "LF_D02",         x: 1220, y:  631 },
		{ region: "OE", room: "OE_RAIL01",      x: 2420, y: 1378 },
		{ region: "OE", room: "OE_RUINCourtYard", x: 2133, y: 1397 },
		{ region: "OE", room: "OE_TREETOP",     x:  468, y: 1782 },
		{ region: "RM", room: "RM_ASSEMBLY",    x: 1550, y:  586 },
		{ region: "RM", room: "RM_CONVERGENCE", x: 1860, y:  670 },
		{ region: "RM", room: "RM_I03",         x:  276, y: 2270 },
		{ region: "SB", room: "SB_D04",         x:  483, y: 1045 },
		{ region: "SB", room: "SB_E04",         x: 1668, y:  567 },
		{ region: "SB", room: "SB_H02",         x: 1559, y:  472 },
		{ region: "SH", room: "SH_A14",         x:  273, y:  556 },
		{ region: "SH", room: "SH_B05",         x:  733, y:  453 },
		{ region: "SH", room: "SH_C08",         x: 2159, y:  481 },
		{ region: "SI", room: "SI_C07",         x:  539, y: 2354 },
		{ region: "SI", room: "SI_D05",         x: 1045, y: 1258 },
		{ region: "SI", room: "SI_D07",         x:  200, y:  400 },
		{ region: "SL", room: "SL_B01",         x:  389, y: 1448 },
		{ region: "SL", room: "SL_B04",         x:  390, y: 2258 },
		{ region: "SL", room: "SL_C04",         x:  542, y: 1295 },
		{ region: "SU", room: "SU_A04",         x:  265, y:  415 },
		{ region: "SU", room: "SU_B12",         x: 1180, y:  382 },
		{ region: "SU", room: "SU_C01",         x:  450, y: 1811 },
		{ region: "UG", room: "UG_A16",         x:  640, y:  354 },
		{ region: "UG", room: "UG_D03",         x:  857, y: 1826 },
		{ region: "UG", room: "UG_GUTTER02",    x:  163, y:  241 },
		{ region: "UW", room: "UW_A07",         x:  805, y:  616 },
		{ region: "UW", room: "UW_C02",         x:  493, y:  490 },
		{ region: "UW", room: "UW_J01",         x:  860, y: 1534 },
		{ region: "VS", room: "VS_C03",         x:   82, y:  983 },
		{ region: "VS", room: "VS_F02",         x: 1348, y:  533 },
		{ region: "VS", room: "VS_H02",         x:  603, y: 3265 },
		//	Bingo customs/adders                
		{ region: "CC", room: "CC_SHAFT0x",     x: 1525, y:  217 },
		{ region: "CL", room: "CL_C03",         x:  808, y:   37 },
		{ region: "DM", room: "DM_VISTA",       x:  956, y:  341 },
		{ region: "DS", room: "DS_GUTTER02",    x:  163, y:  241 },
		{ region: "GW", room: "GW_A24",         x:  590, y:  220 },
		{ region: "HI", room: "HI_B02",         x:  540, y: 1343 },
		{ region: "LC", room: "LC_stripmallNEW", x: 1285, y:   50 },
		{ region: "LF", room: "LF_E01",         x:  359, y:   63 },
		{ region: "LM", room: "LM_B01",         x:  248, y: 1507 },
		{ region: "LM", room: "LM_B04",         x:  503, y: 2900 },
		{ region: "LM", room: "LM_C04",         x:  542, y: 1295 },
		{ region: "LM", room: "LM_EDGE02",      x: 1750, y: 1715 },
		{ region: "MS", room: "MS_AIR03",       x: 1280, y:  770 },
		{ region: "MS", room: "MS_ARTERY01",    x: 4626, y:   39 },
		{ region: "MS", room: "MS_FARSIDE",     x: 2475, y: 1800 },
		{ region: "MS", room: "MS_LAB4",        x:  390, y:  240 },
		{ region: "OE", room: "OE_CAVE02",      x: 1200, y:   35 },
		{ region: "RM", room: "RM_LAB8",        x: 1924, y:   65 },
		{ region: "SB", room: "SB_C02",         x: 1155, y:  550 },
		{ region: "SH", room: "SH_E02",         x:  770, y:   40 },
		{ region: "SI", room: "SI_C04",         x: 1350, y:  130 },
		{ region: "SL", room: "SL_AI",          x: 1530, y:   15 },
		{ region: "SS", room: "SS_A13",         x:  347, y:  595 },
		{ region: "SS", room: "SS_C03",         x:   60, y:  119 },
		{ region: "SS", room: "SS_D04",         x:  980, y:  440 },
		{ region: "SS", room: "SS_LAB12",       x:  697, y:  255 },
		{ region: "SU", room: "SU_B11",         x:  770, y:   48 },
		{ region: "UG", room: "UG_A19",         x:  545, y:   43 },
		{ region: "UW", room: "UW_D05",         x:  760, y:  220 },
		{ region: "VS", room: "VS_E06",         x:  298, y: 1421 }
	];

	/**
	 *	Master list/map of all enums available.
	 *	Key type: list name, as used in Bingo Mod SettingBox lists, and goalDefs `formatter` properties.
	 *	Value type: array of strings; set of creature/item internal names, tokens, region codes, etc.
	 */
	this.enums = {};
	this.enums.banitem = [ "DangleFruit", "EggBugEgg", "WaterNut", "SlimeMold", "JellyFish",
		"Mushroom", "GooieDuck", "LillyPuck", "DandelionPeach", "GlowWeed", "VultureGrub",
		"Hazer", "SmallNeedleWorm", "Fly", "SmallCentipede", "Lantern", "PuffBall",
		"VultureMask", "ScavengerBomb", "FirecrackerPlant", "BubbleGrass", "Rock",
		"SSOracleSwarmer", "KarmaFlower", "FireEgg", "DataPearl", "SporePlant", "FlareBomb",
		"FlyLure", "Creature", "Spear", "Oracle", "PebblesPearl", "SLOracleSwarmer",
		"SeedCob", "VoidSpawn", "AttachedBee", "NeedleEgg", "DartMaggot", "NSHSwarmer",
		"OverseerCarcass", "CollisionField", "BlinkingFlower", "Pomegranate", "LobeTree",
		"JokeRifle", "Bullet", "Spearmasterpearl", "EnergyCell", "Germinator", "MoonCloak",
		"HalcyonPearl", "HRGuard", "Seed", "SingularityBomb" ];
	this.enums.boolean = [ "false", "true" ];
	this.enums.challenges = [];
	for (var g of this.CHALLENGE_DEFS) {
		this.enums.challenges.push(g.name);
	}
	this.enums.characters = this.maps.characters.map(o => o.name);
	this.enums.chatlogs = this.maps.chatlogs.map(o => o.name);
	this.enums.craft = [ "FlareBomb", "SporePlant", "ScavengerBomb", "JellyFish",
		"DataPearl", "BubbleGrass", "FlyLure", "SlimeMold", "FirecrackerPlant", "PuffBall",
		"Mushroom", "Lantern", "GlowWeed", "GooieDuck", "FireEgg", "VultureMask",
		"NeedleEgg", "KarmaFlower", "SingularityBomb", "OverseerCarcass", "SSOracleSwarmer",
		"Seed", "LillyPuck", "Fly", "SmallCentipede", "VultureGrub", "SmallNeedleWorm",
		"Hazer", "TubeWorm", "Snail" ];
	this.enums.creatures = this.maps.creatures.map(o => o.name);
	this.enums.depths = [ "Hazer", "VultureGrub", "SmallNeedleWorm", "TubeWorm",
		"SmallCentipede", "Snail", "LanternMouse" ];
	this.enums.enterablegates = [
		"SU_HI", "SU_LF", "SU_DS", "HI_SU", "HI_CC", "HI_SH", "HI_GW", "HI_VS",
		"VS_HI", "VS_SI", "VS_SL", "VS_SB", "GW_HI", "GW_SL", "GW_DS", "SL_GW",
		"SL_SB", "SL_SH", "SL_VS", "SH_GW", "SH_HI", "SH_UW", "SH_SL", "UW_SH",
		"UW_SL", "UW_CC", "CC_UW", "CC_HI", "CC_DS", "CC_SI", "LF_SU", "LF_SI",
		"LF_SB", "SI_LF", "SI_CC", "SI_VS", "DS_SU", "DS_SB", "DS_GW", "DS_CC",
		"SB_DS", "SB_SL", "SB_VS"
	];
	this.enums.expflags = this.maps.expflags.map(e => e.name);
	this.enums.expobject = [ "FirecrackerPlant", "SporePlant", "FlareBomb", "FlyLure",
		"JellyFish", "Lantern", "Mushroom", "PuffBall", "ScavengerBomb", "VultureMask",
		"DangleFruit", "SlimeMold", "BubbleGrass", "EggBugEgg", "GooieDuck", "LillyPuck",
		"DandelionPeach", "Creature", "Rock", "Spear", "Oracle", "PebblesPearl",
		"SLOracleSwarmer", "SSOracleSwarmer", "DataPearl", "SeedCob", "WaterNut",
		"KarmaFlower", "VoidSpawn", "AttachedBee", "NeedleEgg", "DartMaggot", "NSHSwarmer",
		"OverseerCarcass", "CollisionField", "BlinkingFlower", "Pomegranate", "LobeTree",
		"JokeRifle", "Bullet", "Spearmasterpearl", "FireEgg", "EnergyCell", "Germinator",
		"MoonCloak", "HalcyonPearl", "HRGuard", "Seed", "GlowWeed", "SingularityBomb" ];
	this.enums.food = [ "DangleFruit", "EggBugEgg", "WaterNut", "SlimeMold", "JellyFish",
		"Mushroom", "GooieDuck", "LillyPuck", "DandelionPeach", "GlowWeed", "VultureGrub",
		"Hazer", "SmallNeedleWorm", "Fly", "SmallCentipede", "SSOracleSwarmer",
		"KarmaFlower", "FireEgg", "SLOracleSwarmer" ];
	this.enums.friend = [ "CicadaA", "CicadaB", "GreenLizard", "PinkLizard",
		"YellowLizard", "BlackLizard", "CyanLizard", "WhiteLizard", "BlueLizard",
		"EelLizard", "SpitLizard", "ZoopLizard", "Salamander", "RedLizard" ];
	this.enums.items = this.maps.items.map(o => o.name);
	/** All visitable Iterators.  v1.2: BingoIteratorChallenge uses a Boolean flag to
	  * select base options; this seems fragile for expansion, so, anticipating some
	  * flexibility here and promoting to a String enum.  Hence the odd value of the
	  * first two entries. */
	this.enums.iterators = [
		"true", 	//	Looks To The Moon
		"false" 	//	Five Pebbles
	];
	this.enums.passage = this.maps.passage.map(o => o.name);
	this.enums.pearls = this.maps.pearls.map(o => o.name);
	this.enums.pinnable = [ "CicadaA", "CicadaB", "Scavenger", "BlackLizard",
		"PinkLizard", "BlueLizard", "YellowLizard", "WhiteLizard", "GreenLizard",
		"Salamander", "Dropbug", "Snail", "Centipede", "Centiwing", "LanternMouse" ];
	this.enums.regions = this.maps.regions.map(o => o.code);
	this.enums.regionsreal = this.enums.regions.slice(0);
	this.enums.nootregions = this.enums.regions.slice(0);
	this.enums.popcornregions = this.enums.regions.slice(0);
	this.enums.echoes = this.enums.regions.slice(0);
	/** Subregions; used by BingoDamageChallenge and BingoKillChallenge for legacy support */
	this.enums.subregions = [
		"Any Subregion", "...", "???", "12th Council Pillar, the House of Braids",
		"Ancient Labyrinth", "Atop the Tallest Tower", "Auxiliary Transmission Array",
		"Barren Conduits", "Bitter Aerie", "Chimney Canopy", "Communications Array",
		"Depths", "Desolate Canal", "Desolate Fields", "Drainage System",
		"Facility Roots (Western Intake)", "Farm Arrays", "Filtration System",
		"Five Pebbles", "Five Pebbles (General Systems Bus)",
		"Five Pebbles (Linear Systems Rail)", "Five Pebbles (Memory Conflux)",
		"Five Pebbles (Primary Cortex)", "Five Pebbles (Recursive Transform Array)",
		"Five Pebbles (Unfortunate Development)", "Forgotten Conduit", "Frigid Coast",
		"Frosted Cathedral", "Frozen Mast", "Garbage Wastes", "Glacial Wasteland",
		"Icy Monument", "Industrial Complex", "Journey's End", "Looks to the Moon",
		"Looks to the Moon (Abstract Convergence Manifold)",
		"Looks to the Moon (Memory Conflux)", "Looks to the Moon (Neural Terminus)",
		"Looks to the Moon (Vents)", "Luna", "Memory Crypts", "Metropolis",
		"Outer Expanse", "Outskirts", "Pipeyard", "Primordial Underground",
		"Shaded Citadel", "Shoreline", "Silent Construct", "Sky Islands",
		"Solitary Towers", "Struts", "Submerged Superstructure",
		"Submerged Superstructure (The Heart)", "Submerged Superstructure (Vents)",
		"Subterranean", "Suburban Drifts", "Sump Tunnel", "Sunken Pier", "The Floor",
		"The Gutter", "The Husk", "The Leg", "The Precipice", "The Rot",
		"The Rot (Cystic Conduit)", "The Rot (Depths)", "The Shell", "The Wall",
		"Undergrowth", "Underhang", "Waterfront Facility", "Windswept Spires"
	];
	this.enums.theft = [
		//	ChallengeUtils.stealableStoable
		"Spear", "Rock", "ScavengerBomb", "Lantern", "GooieDuck", "GlowWeed",
		"DataPearl",	//	added by GetCorrectListForChallenge()
		//	ScavengerAI::CollectScore (nonzero values)
		"ExplosiveSpear", "ElectricSpear", "PuffBall", "FlareBomb", "KarmaFlower",
		"Mushroom", "VultureMask", "OverseerCarcass", "FirecrackerPlant",
		"JellyFish", "FlyLure", "SporePlant", "LillyPuck", "SingularityBomb" ];
	this.enums.tolls = [ "su_c02", "gw_c05", "gw_c11", "lf_e03", "ug_toll",
	"cl_a34", "cl_b27", "lc_c10", "lc_longslum", "lc_rooftophop", "lc_templetoll",
	"lc_stripmallnew", "lf_j01", "oe_tower04", "sb_topside" ];
	this.enums.tolls_bombed = [ "empty", "SU_C02|0,0", "GW_C05|0,0", "GW_C11|0,0",
		"LF_E03|0,0", "UG_TOLL|0,0", "CL_A34|0,0", "CL_B27|0,0", "LC_C10|0,0",
		"LC_longslum|0,0", "LC_rooftophop|0,0", "LC_templetoll|0,0",
		"LC_stripmallNEW|0,0", "LF_J01|0,0", "OE_TOWER04|0,0", "SB_TOPSIDE|0,0",
		"SU_C02|0,1", "GW_C05|0,1", "GW_C11|0,1", "LF_E03|0,1", "UG_TOLL|0,1",
		"CL_A34|0,1", "CL_B27|0,1", "LC_C10|0,1", "LC_longslum|0,1",
		"LC_rooftophop|0,1", "LC_templetoll|0,1", "LC_stripmallNEW|0,1", "LF_J01|0,1",
		"OE_TOWER04|0,1", "SB_TOPSIDE|0,1", "SU_C02|1,0", "GW_C05|1,0", "GW_C11|1,0",
		"LF_E03|1,0", "UG_TOLL|1,0", "CL_A34|1,0", "CL_B27|1,0", "LC_C10|1,0",
		"LC_longslum|1,0", "LC_rooftophop|1,0", "LC_templetoll|1,0",
		"LC_stripmallNEW|1,0", "LF_J01|1,0", "OE_TOWER04|1,0", "SB_TOPSIDE|1,0",
		"SU_C02|1,1", "GW_C05|1,1", "GW_C11|1,1", "LF_E03|1,1", "UG_TOLL|1,1",
		"CL_A34|1,1", "CL_B27|1,1", "LC_C10|1,1", "LC_longslum|1,1",
		"LC_rooftophop|1,1", "LC_templetoll|1,1", "LC_stripmallNEW|1,1", "LF_J01|1,1",
		"OE_TOWER04|1,1", "SB_TOPSIDE|1,1" ];
	this.enums.transport = [ "JetFish", "Hazer", "VultureGrub", "CicadaA", "CicadaB",
		"Yeek" ];
	this.enums.unlocksblue = this.maps.creatures.map(o => o.name)
			.concat(this.maps.items.map(o => o.name))
			.sort((a, b) => b < a);
	[
		"Any Creature", "Centipede", "CicadaB", "DataPearl", "Default", "Default",
		"EggBugEgg", "EnergyCell", "ExplosiveSpear", "FireBug", "FireEgg",
		"Fly", "GarbageWorm", "GreenLizard", "HalcyonPearl", "HunterDaddy",
		"JokeRifle", "KarmaFlower", "MoonCloak", "NSHSwarmer", "NeedleEgg",
		"Overseer", "OverseerCarcass", "PebblesPearl", "PinkLizard", "Rock",
		"SLOracleSwarmer", "SSOracleSwarmer", "ScavengerKing", "Seed",
		"SeedCob", "Slugcat", "SmallNeedleWorm", "Spear", "Spear1", "Spear2",
		"Spear3", "Spearmasterpearl", "StowawayBug", "TrainLizard",
		"VultureMask1", "VultureMask2"
	].forEach(s => this.enums.unlocksblue.splice(this.enums.unlocksblue.indexOf(s), 1));
	this.maps.unlocksblue = this.enums.unlocksblue.map(s => ({ type: "blue",
			unlockColor: Bingovista.colors.AntiGold, name: s, text: this.entityDisplayText(s),
			icon: this.entityIconAtlas(s), color: this.entityIconColor(s) }) );
	this.enums.unlocksgold = this.enums.regions.slice(1);
	this.enums.unlocksgold.splice(6, 1); this.enums.unlocksgold.splice(16, 1);	//	no unlock for HR or SS
	this.enums.unlocksgold.splice(5, 0, "GWold"); this.enums.unlocksgold.push("filter", "gutter");
	this.maps.unlocksgold = this.enums.unlocksgold.map(s => ({ type: "gold",
			unlockColor: Bingovista.colors.TokenDefault, name: s,
			text: ({ GWold: "Past Garbage Wastes", filter: "Filtration System",
					gutter: "The Gutter" })[s] || s, icon: "", color: "" }) );	//	can't precompute region display text; special-case it in challenge function
	this.enums.unlocksred = this.enums.regions.slice(1); this.enums.unlocksred.splice(6, 1);
	this.maps.unlocksred = this.enums.unlocksred.map(s => ({ type: "red",
			unlockColor: Bingovista.colors.RedColor, name: s + "-safari",
			text: s, icon: "", color: "" } ));	//	can't precompute region display text; special-case it in challenge function
	this.enums.unlocksred.forEach((s, i) => this.enums.unlocksred[i] = s + "-safari" );
	this.enums.unlocksgreen = [ "Artificer", "Gourmand", "Rivulet", "Saint", "Spearmaster" ];
	this.maps.unlocksgreen = this.enums.unlocksgreen.map(s => ({ type: "green",
			unlockColor: Bingovista.colors.GreenColor, name: s, text: s,
			icon: this.entityIconAtlas("Slugcat"),
			color: this.maps.characters.find(o => o.text === s).color }));
	this.maps.unlocks = this.maps.unlocksblue.concat(this.maps.unlocksgold)
			.concat(this.maps.unlocksred).concat(this.maps.unlocksgreen);
	this.enums.unlocks = this.enums.unlocksblue.concat(this.enums.unlocksgold)
			.concat(this.enums.unlocksred).concat(this.enums.unlocksgreen);
	this.enums.vista_code = this.maps.vistas.map(o => o.region + "><System.String|"
			+ o.room + "|Room|0|vista><" + String(o.x) + "><" + String(o.y));	//	leaving in for legacy
	this.enums.vista = this.maps.vistas.map(o => o.room);	//	rooms only; used for receiving Vista SettingBox
	//	used by BingoVistaExChallenge
	this.enums.vista_region = this.maps.vistas.map(o => o.region);
	this.enums.vista_room   = this.maps.vistas.map(o => o.room);
	this.enums.vista_x      = this.maps.vistas.map(o => o.x);
	this.enums.vista_y      = this.maps.vistas.map(o => o.y);
	this.enums.weapons = [ "Any Weapon", "Spear", "Rock", "ScavengerBomb", "JellyFish",
		"PuffBall", "LillyPuck", "SingularityBomb", "WaterNut" ];
	this.enums.weaponsnojelly = this.enums.weapons.slice(0);

	//	from Watcher update
	var seedCob = { type: "blue", unlockColor: Bingovista.colors.AntiGold, name: "SeedCob", text: "Popcorn Plants", icon: "popcorn_plant", color: "#68283a" };
	this.maps.unlocks.push(seedCob);
	this.maps.unlocksblue.push(seedCob);
	this.enums.unlocks.push(seedCob.name);
	this.enums.unlocksblue.push(seedCob.name);
	//this.maps.characters.push( { name: "Watcher", text: "Watcher", color: "#17234e", icon: "Kill_Slugcat" } );
	//this.enums.characters.push("Watcher");

	//this.initGenerateBlacklist();

	//	Loading resources and data

	//	Start a timer; if resources aren't loaded before it's over, paint targets anyway
	this.resourceTimer = setTimeout(this.resourceCallback.bind(this), 100);
	//this.resourceTimer = setTimeout((function() { this.refresh(); console.log(this.headerId); this.resourceTimer = 0; }).bind(this), 100);
	this.atlases.forEach(a => this.loadAtlas(a));

	if (params !== undefined) this.setup(params);
}


/*                   *
 * * *  Methods  * * *
 *                   */

/**
 *	Requests loading an atlas's resources.
 *	@param atl  an object of the form:
 *	{
 *		img: "url/to/image.png",
 *		txt: "url/to/json.txt",
 *		canv: undefined,
 *		frames: undefined,
 *		txtErr: "",
 *		imgErr: ""
 *	}
 *	Input properties: img, txt; others do-not-care.
 *	Output: canv and frames are immediately set to undefined,
 *	and -Err's to "".  When the requests resolve, canv and
 *	frames are filled with their respective content, or the
 *	respective -Err properties are set.
 */
loadAtlas(atl) {
	atl.txtErr = ""; atl.imgErr = "";
	atl.canv = undefined; atl.frames = undefined;
	var img = document.createElement("img");
	var ard = this.areResourcesDone;
	img.addEventListener("load", function() {
		var canv = document.createElement("canvas");
		canv.width = img.naturalWidth; canv.height = img.naturalHeight;
		var ctx = canv.getContext("2d");
		ctx.drawImage(img, 0, 0);
		atl.canv = canv;
		ard();
	});
	img.addEventListener("error", function(e) {
		atl.imgErr = "Image load failed; resource \"" + atl.img + "\"";
		console.log("loadAtlas error: " + atl.imgErr);
		ard();
	});
	img.crossOrigin = "anonymous";
	img.src = atl.img;

	fetch(atl.txt).then(function(r) {
		//	Request succeeds
		if (r.status == 200) {
			r.text().then(function(s) {
				try {
					atl.frames = JSON.parse(s).frames;
				} catch (e) {
					atl.txtErr = "Parse error; " + e.toString();
					console.log("loadAtlas error: " + atl.txtErr);
				}
				ard();
			});
		} else {
			atl.txtErr = "Not found; resource \"" + atl.txt + "\"";
			console.log("loadAtlas error: " + atl.txtErr);
			ard();
		}
	}, function(r) {
		//	Request failed
		atl.txtErr = "Connection failed; resource \"" + atl.txt + "\"";
		console.log("loadAtlas error: " + atl.txtErr);
		ard();
	});

}

/**
 *	A rhetorical question; handles repaint if/when resources are all
 *	loaded.  Called after each resource fetch; if last one loads before
 *	startup timeout, targets are painted.
 */
areResourcesDone() {
	var done = true;
	for (var i = 0; i < this.atlases.length; i++) {
		done = done && (this.atlases[i].frames !== undefined || this.atlases[i].txtErr > "");
		done = done && (this.atlases[i].canv !== undefined || this.atlases[i].imgErr > "");
	}
	done = done && this.board !== undefined;	//	dataSrc loaded
	if (done) {
		//	got everything in time, cancel the timer
		if (this.resourceTimer) {
			clearTimeout(this.resourceTimer);
			this.resourceTimer = 0;
		}
		this.refresh();
	}
	return done;
}

setup(params) {

	if (params.loadFail !== undefined && typeof(params.loadFail) === "function") {
		this.loadFailureCallbacks.push(params.loadFail);
	}
	if (params.loadSuccess !== undefined && typeof(params.loadSuccess) === "function") {
		this.loadSuccessCallbacks.push(params.loadSuccess);
	}
	if (params.selectCB !== undefined && typeof(params.selectCB) === "function") {
		this.selectCallbacks.push(params.selectCB);
	}
	if (params.mouseCB !== undefined && typeof(params.mouseCB) === "function") {
		this.mouseoverCallbacks.push(params.mouseCB);
	}
	if (params.selection !== undefined && typeof(params.selection) === "object") {
		this.selected = {col: parseInt(params.selection.col), row: parseInt(params.selection.row)};
		if (isNaN(this.selected.col)) this.selected.col = -1;
		if (isNaN(this.selected.row)) this.selected.row = -1;
	}
	if (params.cursor !== undefined) {
		this.cursorEnabled = !!params.cursor;
	}
	if (params.transpose !== undefined) {
		this.transposeEnabled = !!params.transpose;
	}
	if (params.tips !== undefined) {
		this.tipsEnabled = !!params.tips;
	}
	if (params.dataSrc !== undefined && typeof(params.dataSrc) === "string"
			|| params.dataType !== undefined && typeof(params.dataType) === "string") {
		//	If either parameter changes, assume the other is
		//	as intended and always try loading the result
		if (params.dataSrc !== undefined && typeof(params.dataSrc) === "string")
			this.dataSrc = params.dataSrc;
		if (params.dataType !== undefined && typeof(params.dataType) === "string")
			this.dataType = params.dataType;

		if (this.dataType === "text") {
			this.parseText(this.dataSrc);
			for (var f of this.loadSuccessCallbacks) f.call(this);
		} else if (this.dataType === "base64") {
			(function() {
				try {
					this.binToBoard(Bingovista.base64uToBin(this.dataSrc));
				} catch (e) {
					this.board = this.errorBoard("Parsing base64 string failed; " + e.message);
					for (var f of this.loadFailureCallbacks) f.call(this);
					return;
				}
				for (var f of this.loadSuccessCallbacks) f.call(this);
			}).call(this);
		} else if (this.dataType === "short" || this.dataType === "url") {
			var url = undefined;
			if (this.dataType === "short" && this.validateQuery(this.dataSrc))
				url = new URL(this.shortenerLink + this.dataSrc);
			else if (this.dataType === "url")
				url = new URL(this.dataSrc);
			if (url === undefined) {
				this.board = this.errorBoard("Shortener query " + this.dataSrc + " not valid");
				this.areResourcesDone();
				for (var f of this.loadFailureCallbacks) f.call(this);
			} else {
				fetch(url).then(function(r) {
					//	Request succeeds (200 or 404)
					if (r.status == 200) {
						//	is acceptable type?
						var basetype = r.headers.get("content-type").split(";")[0].toLowerCase();
						if (basetype === "application/octet-stream") {
							r.arrayBuffer().then(function(ar) {
								this.respHeader = {
									action: [],
									created: "",
									error: "",
									key: "",
									raw: [],
									status: "",
									views: 0
								};
								if (ar.byteLength < RESP_HEADER_LEN) {
									this.respHeader.error = "Insufficient header received: " + String(ar.byteLength) + " bytes";
								} else {
									this.respHeader.raw = new Uint8Array(ar.slice(0, RESP_HEADER_LEN));
									this.respHeader.status = ([
										"BIN_RESP_OK", "BIN_RESP_NOT_FOUND", "BIN_RESP_NO_KEY", "BIN_RESP_ERROR"
									])[this.respHeader.raw[0]] || "BIN_RESP_UNKNOWN";
									if (this.respHeader.raw[1] & 0x01) this.respHeader.action.push("DB_INFO_PREV_AVAILABLE");
									if (this.respHeader.raw[1] & 0x02) this.respHeader.action.push("DB_INFO_NEXT_AVAILABLE");
									if (this.respHeader.raw[1] & 0x08) this.respHeader.action.push("DB_INFO_NO_MOVE");
									for (var i = 0; i < 16; i++) {
										if (this.respHeader.raw[2 + i] == 0) break;
										this.respHeader.key += String.fromCharCode(this.respHeader.raw[2 + i]);
									}
									var rawTime = Bingovista.readLong(this.respHeader.raw, 18) + Bingovista.readLong(this.respHeader.raw, 22) * (1 << 16) * (1 << 16);
									this.respHeader.created = new Date(rawTime * 1000);
									this.respHeader.views = Bingovista.readLong(this.respHeader.raw, 26) + Bingovista.readLong(this.respHeader.raw, 30) * (1 << 16) * (1 << 16);
								}
								this.binToBoard(new Uint8Array(ar.slice(RESP_HEADER_LEN)));
								this.areResourcesDone();
								for (var f of this.loadSuccessCallbacks) f.call(this);
							}.bind(this));
						} else if (basetype === "text/plain") {
							r.text().then(function(s) {
								this.parseText(s);
								this.areResourcesDone();
								for (var f of this.loadSuccessCallbacks) f.call(this);
							}.bind(this));
						} else {
							this.board = this.errorBoard("Request to URL " + url.toString() + " returned unsupported type " + basetype);
							this.areResourcesDone();
							for (var f of this.loadFailureCallbacks) f.call(this);
						}
					} else {
						//	could also decode 404 response body, but most likely
						//	results in the same conclusion...
						this.board = this.errorBoard("Request to URL " + url.toString() + " failed; HTTP status " + r.status);
						this.areResourcesDone();
						for (var f of this.loadFailureCallbacks) f.call(this);
					}
				}.bind(this), function(e) {
					//	Request failed (network error)
					this.board = this.errorBoard("Request to URL " + url.toString() + " failed; " + e.message);
					this.areResourcesDone();
					for (var f of this.loadFailureCallbacks) f.call(this);
				}.bind(this));
			}
		} else {
			this.board = this.errorBoard("Unsupported dataType: " + this.dataType);
			this.areResourcesDone();
			for (var f of this.loadFailureCallbacks) f.call(this);
		}
	}

	if (params.headerId !== undefined) {
		if (typeof(params.headerId) !== "string" || document.getElementById(params.headerId) === null) {
			params.headerId = undefined;
		}
		var perkb, el = document.getElementById(this.headerId);
		if (el !== null) {
			//	unlink old listeners (if present)
			perkb = el.children[0]?.children[0]?.children[4]?.children[1]?.children[0]?.children[0];
			if (perkb !== undefined) perkb.removeEventListener("click", this.clickShowPerks);
		}
		this.headerId = params.headerId;
		el = document.getElementById(this.headerId);
		if (el !== null) {
			//	link new listeners (if it already had equivalent elements?)
			perkb = el.children[0]?.children[0]?.children[4]?.children[1]?.children[0]?.children[0];
			if (perkb !== undefined) perkb.addEventListener("click", this.clickShowPerks);
		}
	}

	if (params.boardId !== undefined) {
		if (typeof(params.boardId) !== "string" || document.getElementById(params.boardId) === null) {
			params.boardId = undefined;
		}
		var el = document.getElementById(this.boardId);
		if (el !== null) {
			//	unlink old listeners
			el.removeEventListener("click", this.clickBoard);
			el.removeEventListener("mouseover", this.mouseBoard);
			el.removeEventListener("mouseleave", this.mouseleaveBoard);
		}
		this.boardId = params.boardId;
		el = document.getElementById(this.boardId);
		if (el !== null) {
			//	link new listeners
			el.addEventListener("click", this.clickBoard);
			el.addEventListener("mouseover", this.mouseBoard);
			el.addEventListener("mouseleave", this.mouseleaveBoard);
		}
	}

	if (params.selectId !== undefined && typeof(params.selectId) === "string"
			&& document.getElementById(params.selectId) !== null) {
		this.selectId = params.selectId;
	}

	if (params.detailId !== undefined && typeof(params.detailId) === "string"
			&& document.getElementById(params.detailId) !== null) {
		this.detailId = params.detailId;
	}

	this.refresh();
}

validateQuery(s) {
	if (s.length < 4 || s.length > 13) return false;
	for (var i = 0; i < s.length; i++) {
		var c = s.charCodeAt(i);
		if (c < '0'.charCodeAt(0) || c > 'z'.charCodeAt(0) ||
				(c > '9'.charCodeAt(0) && c < 'a'.charCodeAt(0)))
			return false;
	}
	return true;
}

/** Creates a default-value board object with specified error string. */
errorBoard(s) {
	return {
		comments: "",
		character: "",
		perks: undefined,
		shelter: "",
		size: 1,
		width: 1,
		height: 1,
		goals: [this.textToGoal("BingoChallenge~Empty board")],
		text: "",
		srcText: undefined,
		bin: new Uint8Array(),
		srcBin: undefined,
		error: s
	};
}

refresh() {
	this.refreshHeader();
	this.refreshBoard();
	this.selectSquare(this.selected?.col, this.selected?.row);
}

toString() {
	return JSON.stringify({
		data: Bingovista.binToBase64u(this.board.bin),
		cursor: this.cursorEnabled,
		tips: this.tipsEnabled,
		transpose: this.transposeEnabled,
		mods: this.modpacks
	});
}

/**
 *	Looks up a hash code in available / known / installed modpacks.
 */
identifyModpack(hash) {
	return "Unknown Modpack 0x" + ("00000000" + hash.toString(16)).slice(-8);
}


/*                         *
 * * * Event Listeners * * *
 *                         */

/**
 *	Resource timeout
 */
resourceCallback() {
	this.refresh();
	this.resourceTimer = 0;
}

/**
 *	Board view click
 */
clickBoard(e) {
	var r = this.mouseEventToSquare(e);
	if (r === undefined) return;
	this.selectSquare(...r);
	for (var f of this.selectCallbacks) f.apply(this, r);
}

/**
 *	Board view mouseenter/mouseover
 */
mouseBoard(e) {
	var r = this.mouseEventToSquare(e);
	if (r === undefined) return;
	for (var f of this.mouseoverCallbacks) f.apply(this, r);
}

/**
 *	Board view mouseleave/mouseout
 */
mouseleaveBoard(e) {
	for (var f of this.mouseoverCallbacks) f.call(this, -1, -1);
}

/**
 *	Header Show/Hide button click
 */
clickShowPerks(e) {
	if (this.headerId === undefined || this.board === undefined) return;
	const elem = document.getElementById(this.headerId);
	if (elem === null) return;
	var perks = elem?.children[0]?.children[0]?.children[4]?.children[1]?.children[1];
	if (perks === undefined) return;
	if (perks.style.display === "none")
		perks.style.display = "block";
	else
		perks.style.display = "none";
}

/**
 *	Converts a mouseover/click event to a target square location.
 *	@return [col, row] pair, coordinates of a board square; or
 *	[-1, -1] if out of bounds, or undefined if sanity checks fail.
 *	(col, row are in row-first raster order from TL to BR.)
 */
mouseEventToSquare(e) {
	if (this.boardId === undefined || this.board === undefined) return;
	const elem = document.getElementById(this.boardId);
	if (elem === null) return;
	const canv = elem.childNodes[0];
	if (canv === undefined || canv.tagName !== "CANVAS" || e.currentTarget != elem) return;
	const rect = canv.getBoundingClientRect();
	return this.getBoardSquareFromCoord(e.clientX - rect.left, e.clientY - rect.top);
}


/*                              *
 * * * Document Interfacing * * *
 *                              */

/**
 *	Create and assign header table from board data.
 */
refreshHeader() {
	if (this.headerId === undefined || this.board === undefined) return;
	const elem = document.getElementById(this.headerId);
	if (elem === null) return;

	//	Get references to all required elements
	var rows = {}, checks = [], tb = elem?.children[0]?.children[0];
	var names = ["title", "size", "char", "shel", "perkb", "perks", "mods"];
	var indices = [
		[0, 1], [1, 1], [2, 1], [3, 1], [4, 1, 0, 0], [4, 1, 1], [5, 1]
	];
	var flag = (tb === undefined);
	for (var i = 0; i < names.length && !flag; i++) {
		rows[names[i]] = tb;
		flag = flag || (rows[names[i]] === undefined);
		if (flag) break;
		for (var j in indices[i]) {
			rows[names[i]] = rows[names[i]].children[indices[i][j]];
			flag = flag || (rows[names[i]] === undefined);
			if (flag) break;
		}
	}
	for (i = 0; i < this.enums.expflags.length && !flag; i++) {
		checks.push(rows.perks.children[i].children[0]);
		flag = flag || (checks[i] === undefined);
		if (flag) break;
	}
	if (flag) {
		//	hierarchy not as expected; rip out and start over
		//	(note: leaks any attached listeners)
		while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
		var tbd = document.createElement("tbody");
		var tbl = document.createElement("table");
		tbl.setAttribute("class", "bv-header");
		tbl.appendChild(tbd);

		var tr = document.createElement("tr");
		rows.title = document.createElement("td");
		rows.title.appendChild(document.createTextNode("Title"));
		tr.appendChild(rows.title);
		rows.title = document.createElement("td");
		rows.title.appendChild(document.createTextNode(this.board.comments || "Untitled"));
		tr.appendChild(rows.title);
		tbd.appendChild(tr);

		tr = document.createElement("tr");
		rows.size = document.createElement("td");
		rows.size.appendChild(document.createTextNode("Size"));
		tr.appendChild(rows.size);
		rows.size = document.createElement("td");
		rows.size.appendChild(document.createTextNode(String(this.board.width) + " x " + String(this.board.height)));
		tr.appendChild(rows.size);
		tbd.appendChild(tr);

		tr = document.createElement("tr");
		rows.char = document.createElement("td");
		rows.char.appendChild(document.createTextNode("Character"));
		tr.appendChild(rows.char);
		rows.char = document.createElement("td");
		rows.char.appendChild(document.createTextNode(this.board.character || "Any"));
		tr.appendChild(rows.char);
		tbd.appendChild(tr);

		tr = document.createElement("tr");
		rows.shel = document.createElement("td");
		rows.shel.appendChild(document.createTextNode("Shelter"));
		tr.appendChild(rows.shel);
		rows.shel = document.createElement("td");
		if (this.board.shelter)
			rows.shel.innerHTML = this.getMapLink(this.board.shelter, this.board.character);
		else
			rows.shel.appendChild(document.createTextNode("random"));
		tr.appendChild(rows.shel);
		tbd.appendChild(tr);

		tr = document.createElement("tr");
		var perktd = document.createElement("td");
		perktd.appendChild(document.createTextNode("Perks/flags"));
		tr.appendChild(perktd);
		perktd = document.createElement("td");
		tr.appendChild(perktd);
		rows.perks = document.createElement("div");
		rows.perks.setAttribute("style", "margin-bottom: 4px;");
		rows.perkb = document.createElement("input");
		rows.perkb.setAttribute("type", "button");
		rows.perkb.setAttribute("value", "Show / Hide");
		rows.perkb.setAttribute("tabindex", "0");
		rows.perkb.addEventListener("click", this.clickShowPerks);
		rows.perks.appendChild(rows.perkb);
		perktd.appendChild(rows.perks);
		rows.perks = document.createElement("div");
		rows.perks.setAttribute("style", "margin-bottom: 4px; display: none;");
		perktd.appendChild(rows.perks);
		var p = this.board.perks | 0;
		checks = [];
		for (var i = 0; i < this.maps.expflags.length; i++) {
			checks.push(document.createElement("input"));
			checks[i].setAttribute("type", "checkbox");
			checks[i].setAttribute("class", "bv-perkscheck");
			checks[i].setAttribute("disabled", "");
			if (p & this.maps.expflags[i].value)
				checks[i].setAttribute("checked", "");
			var label = document.createElement("label");
			label.setAttribute("class", "bv-perkslabel");
			label.appendChild(checks[i]);
			label.appendChild(document.createTextNode(this.maps.expflags[i].title));
			rows.perks.appendChild(label);
		}
		tbd.appendChild(tr);

		tr = document.createElement("tr");
		rows.mods = document.createElement("td");
		rows.mods.appendChild(document.createTextNode("Mods"));
		tr.appendChild(rows.mods);
		rows.mods = document.createElement("td");
		rows.mods.setAttribute("class", "bv-perkscheck");
		tr.appendChild(rows.mods);
		tbd.appendChild(tr);
		addModsToElement.call(this, rows.mods);

		elem.appendChild(tbl);
		return;
	}

	//	Set header elements
	while (rows.title.childNodes.length) rows.title.removeChild(rows.title.childNodes[0]);
	rows.title.appendChild(document.createTextNode(this.board.comments || "Untitled"));
	while (rows.size.childNodes.length) rows.size.removeChild(rows.size.childNodes[0]);
	rows.size.appendChild(document.createTextNode(String(this.board.width) + " x " + String(this.board.height)));
	while (rows.char.childNodes.length) rows.char.removeChild(rows.char.childNodes[0]);
	rows.char.appendChild(document.createTextNode(this.board.character || "Any"));
	while (rows.shel.childNodes.length) rows.shel.removeChild(rows.shel.childNodes[0]);
	if (this.board.shelter)
		rows.shel.innerHTML = this.getMapLink(this.board.shelter, this.board.character);
	else
		rows.shel.appendChild(document.createTextNode("random"));

	//	Set perks
	var p = this.board.perks | 0;
	for (var i = 0; i < checks.length; i++) {
		if (p & this.maps.expflags[i].value)
			checks[i].setAttribute("checked", "");
		else
			checks[i].removeAttribute("checked");
		var label = checks[i].parentElement;
		while (label.childNodes.length > 1) label.removeChild(label.childNodes[1]);
		label.appendChild(document.createTextNode(this.maps.expflags[i].title));
	}

	addModsToElement.call(this, rows.mods);

	function addModsToElement(el) {
		while (el.childNodes.length) el.removeChild(el.childNodes[0]);
		if (!this.modpacks.length) {
			el.appendChild(document.createTextNode("none"));
			return;
		}
		var td = document.createElement("td");
		var tr = document.createElement("tr");
		var tbd = document.createElement("tbody");
		var tbl = document.createElement("table");
		tbl.setAttribute("class", "bv-headermods");
		td.appendChild(document.createTextNode("Number"));
		tr.appendChild(td);
		td = document.createElement("td");
		td.appendChild(document.createTextNode("Hash"));
		tr.appendChild(td);
		td = document.createElement("td");
		td.appendChild(document.createTextNode("Name"));
		tr.appendChild(td);
		tbd.appendChild(tr);
		tbl.appendChild(tbd);
		el.appendChild(tbl);
		for (var i = 0; i < this.modpacks.length; i++) {
			tr = document.createElement("tr");
			tbd.appendChild(tr);
			td = document.createElement("td");
			td.appendChild(document.createTextNode(String(i + 1)));
			td.setAttribute("style", "text-align: center;");
			tr.appendChild(td);
			td = document.createElement("td");
			td.appendChild(document.createTextNode(this.modpacks[i].hash.toString(16)));
			tr.appendChild(td);
			td = document.createElement("td");
			td.appendChild(document.createTextNode(this.modpacks[i].name));
			tr.appendChild(td);
		}
	}

}

/**
 *	Redraws the board to canvas.
 */
refreshBoard() {
	if (this.boardId === undefined || this.board === undefined) return;
	const elem = document.getElementById(this.boardId);
	if (elem === null) return;
	var canv = elem.children[0], curs = elem.children[1];
	if (canv === undefined || canv.getContext === undefined || curs === undefined) {
		//	hierarchy not as expected; rip out and start over
		//	(note: leaks any attached listeners)
		while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
		elem.setAttribute("class", "bv-board");
		canv = document.createElement("canvas");
		//	Get size from container element; if unrealistic, set the internal default
		canv.setAttribute("class", "bv-boardcanv");
		canv.width  = Math.round(elem.getBoundingClientRect().width ) - 2;
		canv.height = Math.round(elem.getBoundingClientRect().height) - 2;
		if (canv.width < 48 || canv.height < 48) {
			//	parent dimensions may be unset; use BV default
			canv.width = 454; canv.height = 454;
		}
		elem.appendChild(canv);
		curs = document.createElement("div");
		curs.setAttribute("class", "bv-boardcur");
		curs.style.display = "none";
		elem.appendChild(curs);
	}

	var width, height;
	[width, height] = this.getBoardSquareSize(canv);
	var ctx = canv.getContext("2d");
	ctx.fillStyle = this.square.background;
	ctx.fillRect(0, 0, canv.width, canv.height);
	var cols = this.board.width, rows = this.board.height;
	if (this.transposeEnabled) [cols, rows] = [rows, cols];
	for (var row = 0; row < rows; row++) {
		for (var col = 0; col < cols; col++) {
			if (this.getGoal(col, row) !== undefined)
				this.drawSquare("board", this.getGoal(col, row), ...this.getBoardSquareOrigin(canv, col, row));
		}
	}

	if (this.selected === undefined)
		this.selected = {col: -1, row: -1};
	this.setCursor(this.selected.col, this.selected.row);
}

/**
 *	Position cursor above board canvas.
 *	Has no effect if board hierarchy is not as expected; call
 *	refreshBoard() first to ensure valid structure.
 *	@param col  column and
 *	@param row  row on board canvas to select
 *	(col, row are in row-first raster order from TL to BR.)
 */
setCursor(col, row) {
	if (this.boardId === undefined || this.board === undefined) return;
	const elem = document.getElementById(this.boardId);
	if (elem === null) return;
	var canv = elem.children[0], curs = elem.children[1];
	if (canv === undefined || canv.getContext === undefined || curs === undefined) {
		if (curs !== undefined)
			curs.style.display = "none";
		return;
	}
	if (!this.cursorEnabled || col < 0 || col >= this.board.width || row < 0
			|| row >= this.board.height || this.getGoal(col, row) === undefined) {
		curs.style.display = "none";
		return;
	}
	var width, height;
	[width, height] = this.getBoardSquareSize(canv);
	//	Firefox border offset bug
	var fixX = 0, fixY = 0;
	if (typeof mozInnerScreenX !== "undefined" || typeof InstallTrigger !== "undefined") {
		fixX = 0; fixY = 0;
	}
	var bdr = parseInt(getComputedStyle(curs).borderWidth);
	if (isNaN(bdr)) bdr = 0;
	curs.style.width  = String(width  + this.square.border - (bdr + fixX)) + "px";
	curs.style.height = String(height + this.square.border - (bdr + fixY)) + "px";
	var x, y;
	[x, y] = this.getBoardSquareOrigin(canv, col, row);
	curs.style.left = String(x - 1 - bdr / 2 + fixX) + "px"; curs.style.top = String(y - 1 - bdr / 2 + fixY) + "px";
	curs.style.display = "initial";
}

/**
 *	Select the square at (col, row) to show in container element
 *	selectId, and details in container element detailId.
 *	If either argument is out of range, clears the selection instead.
 *	@param col  column and
 *	@param row  row on board canvas to select.
 *	(col, row are in row-first raster order from TL to BR.)
 */
selectSquare(col, row) {
	var ctx, elem, goal, width, height;
	this.selected = { col: col, row: row };
	this.setCursor(col, row);
	if (this.selectId !== undefined) {
		elem = document.getElementById(this.selectId);
		if (elem !== null) {
			var canv = elem.children[0];
			if (canv === undefined || canv.getContext === undefined) {
				//	hierarchy not as expected; rip out and start over
				//	(note: leaks any attached listeners)
				while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
				canv = document.createElement("canvas");
				//	Get size from container element; if unrealistic, set the internal default
				elem.setAttribute("class", "bv-select");
				canv.setAttribute("class", "bv-selectcanv");
				canv.width  = Math.round(elem.getBoundingClientRect().width ) - 2;
				canv.height = Math.round(elem.getBoundingClientRect().height) - 2;
				if (canv.width < 32 || canv.height < 32) {
					//	parent dimensions may be unset; use BV default
					canv.width = 100; canv.height = 100;
				}
				elem.appendChild(canv);
			}
			ctx = canv.getContext("2d");
			ctx.fillStyle = this.square.background;
			ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
			if (col >= 0 && col < this.board.width && row >= 0 && row <= this.board.height
					&& this.getGoal(col, row) !== undefined) {
				this.drawSquare("select", this.getGoal(col, row));
			}
		}
	}

	if (this.detailId === undefined) return;
	elem = document.getElementById(this.detailId);
	if (elem === null) return;
	elem.setAttribute("class", "bv-desctxt");
	if (!(col >= 0 && row >= 0 && col < this.board.width && row <= this.board.height
			&& this.getGoal(col, row) !== undefined)) {
		while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
		elem.appendChild(document.createTextNode(this.unselectText));
		return;
	}
	goal = this.getGoal(col, row);
	while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
	var el2 = document.createElement("div");
	el2.setAttribute("class", "bv-descch");
	el2.appendChild(document.createTextNode("Challenge: " + goal.category));
	elem.appendChild(el2);
	el2 = document.createElement("div");
	el2.setAttribute("class", "bv-descdesc");
	//	If content is "trusted", let it use HTML; else, escape it because it contains board text that'll be misinterpreted as HTML
	if (goal.name === "BingoChallenge")
		el2.appendChild(document.createTextNode(goal.description));
	else
		el2.innerHTML = goal.description;
	elem.appendChild(el2);
	el2 = document.createElement("table");
	el2.setAttribute("class", "bv-desclist");
	var tbh = document.createElement("thead");
	var tr = document.createElement("tr");
	var td = document.createElement("td");
	td.appendChild(document.createTextNode("Parameter"));
	tr.appendChild(td);
	td = document.createElement("td");
	td.appendChild(document.createTextNode("Value"));
	tr.appendChild(td);
	tbh.appendChild(tr);
	tbh = document.createElement("tbody");
	for (var i = 0; i < goal.items.length && i < goal.values.length; i++) {
		if (goal.items[i].length > 0) {
			tr = document.createElement("tr");
			td = document.createElement("td");
			td.appendChild(document.createTextNode(goal.items[i]));
			tr.appendChild(td);
			td = document.createElement("td");
			td.appendChild(document.createTextNode(goal.values[i]));
			td.style.wordWrap = "anywhere";
			tr.appendChild(td);
			tbh.appendChild(tr);
		}
	}
	el2.appendChild(tbh);
	elem.appendChild(el2);
	if (this.tipsEnabled && goal.comments.length > 0) {
		el2 = document.createElement("div"); el2.setAttribute("class", "bv-desccomm");
		el2.innerHTML = goal.comments;
		elem.appendChild(el2);
	}

}

/**
 *	Draw a challenge square to the specified canvas at the
 *	specified location (relative to the top-left corner).
 *	@param target  <string> target to draw on; one of ["board", "select"]
 *	@param goal    abstract goal/challenge object to draw (`paint`
 *	               property required; see parseText() and CHALLENGES[])
 *	@param x, y    coordinates to draw at (optional for "select")
 */
drawSquare(target, goal, x, y) {
	var canv, ctx, elem, width, height;
	if (target === "board") {
		if (this.boardId === undefined || this.board === undefined) return;
		elem = document.getElementById(this.boardId);
		if (elem === null) return;
		canv = elem.children[0];
		if (canv === undefined || canv.getContext === undefined) return;
		ctx = canv.getContext("2d");
		[width, height] = this.getBoardSquareSize(canv);
	} else if (target === "select") {
		if (this.selectId === undefined) return;
		elem = document.getElementById(this.selectId);
		if (elem === null) return;
		canv = elem.children[0];
		if (canv === undefined || canv.getContext === undefined) return;
		ctx = canv.getContext("2d");
		width  = canv.width  - (this.square.selMargin + this.square.border) * 2;
		height = canv.height - (this.square.selMargin + this.square.border) * 2;
		if (x === undefined) x = this.square.selMargin + this.square.border;
		if (y === undefined) y = this.square.selMargin + this.square.border;
	} else {
		return;
	}
	ctx.beginPath();
	ctx.strokeStyle = this.square.color;
	ctx.lineWidth = this.square.border;
	ctx.roundRect(x, y, width, height, this.square.radius);
	ctx.stroke();
	ctx.imageSmoothingEnabled = "false";
	var lines = [], thisLine = [];
	for (var i = 0; i < goal.paint.length; i++) {
		if (goal.paint[i].type === "break") {
			lines.push(thisLine);
			thisLine = [];
		} else {
			thisLine.push(goal.paint[i]);
		}
	}
	if (thisLine.length) lines.push(thisLine);
	ctx.font = this.square.font;
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	var xBase, yBase;
	for (var i = 0; i < lines.length; i++) {
		if (lines.length == 2)	//	not sure why this special case, but it seems to better match how the mod has it
			yBase = y + this.square.border / 2 + (height - this.square.border) * (i + 1) / (lines.length + 1);
		else
			yBase = y + this.square.border / 2 + (height - this.square.border) * (i + 0.5) / lines.length;
		yBase = Math.round(yBase);
		for (var j = 0; j < lines[i].length; j++) {
			if (lines[i].length == 2)
				xBase = x + this.square.border / 2 + (width - this.square.border) * (j + 1) / (lines[i].length + 1);
			else
				xBase = x + this.square.border / 2 + (width - this.square.border) * (j + 0.5) / lines[i].length;
			xBase = Math.round(xBase);
			if (lines[i][j].type === "icon") {
				if (lines[i][j].background !== undefined && lines[i][j].background.type === "icon") {
					this.drawIcon(ctx, lines[i][j].background.value, xBase, yBase, lines[i][j].background.color, lines[i][j].background.scale, lines[i][j].background.rotation);
				}
				this.drawIcon(ctx, lines[i][j].value, xBase, yBase, lines[i][j].color, lines[i][j].scale, lines[i][j].rotation);
			} else if (lines[i][j].type === "text") {
				ctx.fillStyle = lines[i][j].color;
				ctx.fillText(lines[i][j].value, xBase, yBase);
			} else {
				//	unimplemented
				this.drawIcon(ctx, "Futile_White", xBase, yBase, Bingovista.colors.Unity_white, lines[i][j].scale || 1, lines[i][j].rotation || 0);
			}
		}
	}
}

/**
 *	Draws the specified icon to the canvas, at location (on center).
 */
drawIcon(ctx, icon, x, y, colr, scale, rot) {
	ctx.translate(x, y);
	ctx.rotate(rot * Math.PI / 180);
	ctx.scale(scale, scale);
	var spri, src;
	if (icon === undefined) {
		//	Doesn't exist, draw dummy square
		ctx.fillStyle = colr;
		ctx.fillRect(-8, -8, 16, 16);
	} else {
		//	Search atlases for sprite
		for (var i = 0; i < this.atlases.length; i++) {
			if (this.atlases[i].frames !== undefined) {
				spri = this.atlases[i].frames[icon + ".png"];
				src = this.atlases[i].canv;
				if (spri !== undefined && src !== undefined)
					break;
			}
		}
		if (spri === undefined) {
			//	Can't find it, draw dummy square
			ctx.fillStyle = colr;
			ctx.fillRect(-8, -8, 16, 16);
		} else {
			var composite = document.createElement("canvas");
			composite.width = spri.frame.w; composite.height = spri.frame.h;
			var ctx2 = composite.getContext("2d");
			ctx2.globalCompositeOperation = "source-over";
			ctx2.clearRect(0, 0, spri.frame.w, spri.frame.h);
			ctx2.drawImage(src, spri.frame.x, spri.frame.y, spri.frame.w, spri.frame.h,
					0, 0, spri.frame.w, spri.frame.h);
			ctx2.globalCompositeOperation = "multiply";
			ctx2.fillStyle = colr;
			ctx2.fillRect(0, 0, spri.frame.w, spri.frame.h);
			ctx2.globalCompositeOperation = "destination-in";
			ctx2.drawImage(src, spri.frame.x, spri.frame.y, spri.frame.w, spri.frame.h,
					0, 0, spri.frame.w, spri.frame.h);
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(composite, 0, 0, spri.frame.w, spri.frame.h,
					Math.round(-spri.frame.w / 2), Math.round(-spri.frame.h / 2), spri.frame.w, spri.frame.h);
		}
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 *	Calculates width and height of a square drawn on the
 *	board, at current settings.
 *	@param canv  canvas element being drawn to
 *	@return  [width, height] of the outer/bounding rectangle
 *	         (measured to border centerline)
 */
getBoardSquareSize(canv) {
	var cols = this.board.width, rows = this.board.height;
	if (this.transposeEnabled) [cols, rows] = [rows, cols];
	return [
		Math.round((canv.width  - (this.square.margin + this.square.border) * (cols + 1)) / cols),
		Math.round((canv.height - (this.square.margin + this.square.border) * (rows + 1)) / rows)
	];
}

/**
 *	Calculates origin coordinates of a square drawn on the
 *	board, at current settings.
 *	@param canv  canvas element being drawn to
 *	@param col   column and
 *	@param row   row of goal square to locate
 *	(col, row are in row-first raster order from TL to BR.)
 *	@return  [x, y] top-left corner of the outer/bounding
 *	         rectangle (measured to border centerline)
 */
getBoardSquareOrigin(canv, col, row) {
	var cols = this.board.width, rows = this.board.height;
	if (this.transposeEnabled) [cols, rows] = [rows, cols];
	var width  = Math.round((canv.width  - (this.square.margin + this.square.border) * (cols + 1)) / cols);
	var height = Math.round((canv.height - (this.square.margin + this.square.border) * (rows + 1)) / rows);
	return [
		Math.round(col * (width  + this.square.margin + this.square.border)
				+ this.square.margin + this.square.border / 2),
		Math.round(row * (height + this.square.margin + this.square.border)
				+ this.square.margin + this.square.border / 2)
	];
}

/**
 *	Calculates the target square based on board (graphical)
 *	coordinates, and current settings.
 *	@param x, y  coordinates on board canvas
 *	@return  [col, row] of the square at (x, y), or [-1, -1]
 *	if out of bounds or in the margin between squares, or
 *	undefined if sanity checks fail.
 *	(col, row are in row-first raster order from TL to BR.)
 */
getBoardSquareFromCoord(x, y) {
	if (this.boardId === undefined || this.board === undefined) return;
	const elem = document.getElementById(this.boardId);
	if (elem === null) return;
	var canv = elem.children[0];
	if (canv === undefined) return;
	if (x < 0 || x > canv.width || y < 0 || y >= canv.height) return [-1, -1];
	var cols = this.board.width, rows = this.board.height;
	if (this.transposeEnabled) [cols, rows] = [rows, cols];
	var width  = Math.round((canv.width  - (this.square.margin + this.square.border) * (cols + 1)) / cols);
	var height = Math.round((canv.height - (this.square.margin + this.square.border) * (rows + 1)) / rows);
	x -= this.square.margin + Math.round(this.square.border / 2);
	y -= this.square.margin + Math.round(this.square.border / 2);
	var xdiv = width  + this.square.margin + this.square.border;
	var ydiv = height + this.square.margin + this.square.border;
	var xrem = x % xdiv, yrem = y % ydiv;
	if (xrem < 0 || xrem >= width || yrem < 0 || yrem >= height) return [-1, -1];
	return [Math.floor(x / xdiv), Math.floor(y / ydiv)];
}

/**
 *	Calculates origin coordinates of a square drawn on the
 *	board, at current settings.
 *	@param canv  canvas element being drawn to
 *	@param idx   index (in this.board.goals) of goal square to locate
 *	@return  [width, height] of the outer/bounding rectangle
 *	         (measured to border centerline)
 */
getBoardSquareOriginIdx(canv, idx) {
	var cols = this.board.width, rows = this.board.height;
	if (this.transposeEnabled) {
		[cols, rows] = [rows, cols];
		[col, row] = [row, col];
	}
	var width  = Math.round((canv.width  - (this.square.margin + this.square.border) * (cols + 1)) / cols);
	var height = Math.round((canv.height - (this.square.margin + this.square.border) * (rows + 1)) / rows);
	return [
		Math.round(Math.floor(idx / cols) * (width + this.square.margin + this.square.border)
				+ this.square.margin + this.square.border / 2),
		Math.round((idx % cols) * (height + this.square.margin + this.square.border)
				+ this.square.margin + this.square.border / 2)
	];
}

/**
 *	Gets the goal at (col, row), at current settings.
 *	@param col   column and
 *	@param row   row of goal square to find
 *	(col, row are in row-first raster order from TL to BR.)
 *	@return  element from this.board.goals, or undefined if not found.
 */
getGoal(col, row) {
	var cols = this.board.width, rows = this.board.height;
	if (this.transposeEnabled) {
		[cols, rows] = [rows, cols];
		[col, row] = [row, col];
	}
	if (col < 0 || col >= cols || row < 0 || row >= rows)
		return undefined;
	return this.board.goals[col + row * cols];
}

/**
 *	Converts sub/region names to their display text, as appropriate for
 *	the selected character.
 *	@param ch      character name (from this.enums.characters), or "Any" to emit
 *	               both normal and Saint names when available
 *	@param reg     region code (from this.maps.regions[].code), or "Any Region"
 *	               to disable
 *	@param subreg  subregion name (from this.enums.subregions), or "Any Subregion"
 *	               to disable
 *	@return String, display text
 */
regionToDisplayText(ch, reg, subreg) {
	if (this.maps.characters.find(o => o.text === ch) === undefined || ch === "Nightcat") ch = "Any";
	var s = "";
	if (subreg !== undefined && subreg !== "Any Subregion") {
		s = subreg;
	} else if (reg !== "Any Region") {
		var o = this.maps.regions.find(o => o.code === reg);
		if (o === undefined || (o.text === undefined && o.saintText === undefined)) {
			s = reg;
		} else if (o.text !== undefined && o.saintText !== undefined) {
			if (ch === "Any")
				s = o.text + " / " + o.saintText;
			else if (ch === "Saint")
				s = o.saintText;
			else
				s = o.text;
		} else {
			s = o.text || o.saintText;
		}
	}
	return s;
}

/**
 *	Generate a valid? HTML link to the RW map viewer (from this.mapLink).
 *	@param room          room name to link to (also link text)
 *	@param chr           character name (e.g. this.board.character); "Survivor" default
 *	@param textOverride  (optional) link text, if different from room name is desired
 *	@return (String) HTML anchor tag
 */
getMapLink(room, chr, textOverride) {
	if (this.mapLink === "")
		return "";
	var reg = Bingovista.regionOfRoom(room);

	//	Replacements from BingoVistaChallenge.cs
	if (room === "GW_E02" && (chr === "Artificer" || chr === "Spearmaster")) room = "GW_E02_PAST";
	if (room === "GW_D01" && (chr === "Artificer" || chr === "Spearmaster")) room = "GW_D01_PAST";
	if (room === "UW_C02" && chr === "Rivulet") room = "UW_C02RIV";
	if (room === "UW_D05" && chr === "Rivulet") room = "UW_D05RIV";

	var ch = this.enums.characters.find(s => s === chr) || "White";
	ch = ch.toLowerCase();
	return "<a href=\"" + this.mapLink + "?slugcat=" + ch + "&region=" + reg + "&room="
			+ room + "\" target=\"_blank\" title=\"View on interactive map\">" + (textOverride || room) + "</a>";
}

/**
 *	Assigns plural to a proper noun, including special cases from
 *	used names (see this.pluralReplacers[]).
 *	Default: for n != 1, concatenates number, space, name.
 *	For n == 1, tests for special cases (ref: this.maps.creatures,
 *	this.maps.items), converting it to the English singular case
 *	("a Batfly", etc.).
 *	@param n        quantity of thing
 *	@param s        name of thing
 *	@param article  (optional) true (default): prepend "a"/"an" to
 *	                singular; false: don't add
 */
entityNameQuantify(n, s, article = true) {
	if (n != 1)
		return String(n) + " " + s;
	for (var i = 0; i < this.pluralReplacers.length; i++) {
		s = s.replace(this.pluralReplacers[i].regex, () => {
			var s = this.pluralReplacers[i].text;
			i = this.pluralReplacers.length;
			return s;
		} );
	}
	if (/^[AEIOU]/i.test(s))
		s = "an " + s;
	else
		s = "a " + s;
	return s;
}

entityDisplayText(e) {
	return this.maps.creatures.find(o => o.name === e)?.text || this.maps.items.find(o => o.name === e)?.text || e;
}

entityIconAtlas(e) {
	return this.maps.creatures.find(o => o.name === e)?.icon || this.maps.items.find(o => o.name === e)?.icon || e;
}

entityIconColor(e) {
	return this.maps.creatures.find(o => o.name === e)?.color || this.maps.items.find(o => o.name === e)?.color || this.maps.items.find(o => o.name === "Default").color;
}

/**
 *	Converts a string in the given shorthand named enum to its binary stored value.
 */
enumToValue(s, en) {
	return this.enums[en].indexOf(s) + 1;
}

/**
 *	Apply a boolean (1 bit) to the array at given offset and bit position.
 *	@param a     (array) array of length at least offs to apply to
 *	@param offs  (number) offset to apply at
 *	@param bit   (number) bit position to apply to
 *	@param bool  (boolean) bit to apply, `true` = 1, `false` = 0
 */
static applyBool(a, offs, bit, bool) {
	if (bool)
		a[offs] |= (1 << bit);
	else
		a[offs] &= ~(1 << bit);
}

/**
 *	Apply a short integer (WORD) to the array at given offset.
 *	a     array of length at least offs + 2
 *	offs  offset to apply at
 *	n     integer to apply, little-endian, unsigned
 */
static applyShort(a, offs, n) {
	a[offs] = (n >>> 0) & 0xff; a[offs + 1] = (n >>> 8) & 0xff;
}

/**
 *	Apply a long integer (DWORD) to the array at given offset.
 *	a     array of length at least offs + 4
 *	offs  offset to apply at
 *	n     integer to apply, little-endian, unsigned
 */
static applyLong(a, offs, n) {
	a[offs + 0] = (n >>>  0) & 0xff; a[offs + 1] = (n >>>  8) & 0xff;
	a[offs + 2] = (n >>> 16) & 0xff; a[offs + 3] = (n >>> 24) & 0xff;
}

/**
 *	Read a short integer (WORD) from the array at given offset.
 *	a     array of length at least offs + 2
 *	offs  offset to apply at
 *	returns: unsigned, little-endian
 */
static readShort(a, offs) {
	return (a[offs] << 0) + (a[offs + 1] << 8);
}

/**
 *	Read a long integer (DWORD) from the array at given offset.
 *	a     array of length at least offs + 4
 *	offs  offset to apply at
 *	returns: unsigned, little-endian
 */
static readLong(a, offs) {
	return (a[offs] << 0) + (a[offs + 1] << 8) + (a[offs + 2] << 16) + (a[offs + 3] * (1 << 24));
}
/**
 *	Finds the given string, in CHALLENGE_DEFS[i].name,
 *	returning the first matching index i, or -1 if not found.
 */
challengeValue(s) {
	return this.CHALLENGE_DEFS.findIndex(a => a.name === s);
}

/**
 *	Converts a byte array to a "URL safe" base64 string,
 *	using these substitutions:
 *	'+' -> '-'
 *	'/' -> '_'
 *	'=' -> ''
 */
static binToBase64u(a) {
	var s = btoa(String.fromCharCode.apply(null, a));
	return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 *	Converts a "URL safe" base64 string to a byte array,
 *	using these substitutions:
 *	'-' -> '+'
 *	'_' -> '/'
 *	'*' -> '='
 */
static base64uToBin(s) {
	s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\*/g, "=");
	return new Uint8Array(atob(s).split("").map( c => c.charCodeAt(0) ));
}

/**
 *	Extract region code from given room code string.
 *	All extant regions follow this pattern, so, probably safe enough?
 */
static regionOfRoom(r) {
	return r.substring(0, r.search("_"));
}


/*                                     *
 * * * Board Encoding and Decoding * * *
 *                                     */

/**
 *	Performs version upgrade patching for the given challenge descriptor
 *	and upgrade array.
 *
 *	Assumption: version differences are expressed by varying the number
 *	of parameters in a challenge.  As long as this assumption bears true,
 *	we can identify version by d.length, and make corrections as needed,
 *	adapting old versions to the current-version parser.
 *
 *	@param d  array of strings; challenge descriptor to patch (is modified in place)
 *	@param upg  sparse array specifying upgrade patching:
 *		- upg is indexed by d.length
 *		- if there is no matching entry in upg (upg[d.length] === undefined),
 *		  no action is taken: d is either an acceptable version, or unknown
 *		  (and probably an error).
 *		- When a matching entry exists, it contains a list of steps to apply
 *		  to d to update it to a newer version.  This may be an intermediate
 *		  version, or directly to latest.  Just make sure there is no sequence
 *		  of update steps that would cause it to loop forever(!).
 *		- Expected structure:
 *		upg = {
 *			3: [
 *				//	d.splice(offs, rem, ...data)
 *				{ op: "splice", offs: 2, rem: 0, data: ["insert string 1", "insert string 2"] },
 *				//	d.push(...data)
 *				{ op: "push", data: ["new last string"] }
 *			],
 *			4: [
 *				//	d.unshift(...data)
 *				{ op: "unshift", data: ["new first string"] },
 *				//	d[offs] = d[offs].replace(find, replace)
 *				{ op: "replace", offs: 2, find: "insert string", replace: "added text" }
 *				//	d[offs] = before + d[offs] + after
 *				{ op: "intFormat", offs: 3, before: "prefix ", after: " suffix" }
 *			]
 *		};
 *		Executing upg on d = ["foo", "bar", "baz"] gives the result:
 *		["new first string", "foo", "bar", "insert string 1", "added text 2", "baz", "new last string"]
 *		Optional upg element parameter:
 *			cond: { type: "search", idx: 8, str: "mushroom", find: false }
 *		If present, checks d[idx] for string str, and executes the step if `find` matches.
 *	@return d is modified in place; it's also returned for convenience
 */
static upgradeDescriptor(d, upg) {
	var iterations = 0, l;
	do {
		l = d.length;
		if (upg[l] === undefined) {
			break;
		} else {
			for (var i = 0; i < upg[l].length; i++) {
				var step = upg[l][i];
				if (step.cond !== undefined
						&& step.cond.type === "search"
						&& d[step.cond.idx] !== undefined
						&& (d[step.cond.idx].search(step.cond.str) < 0) === step.cond.find)
							continue;
				if (step.op === "splice") {
					d.splice(step.offs, step.rem, ...step.data);
				} else if (step.op === "push") {
					d.push(...step.data);
				} else if (step.op === "unshift") {
					d.unshift(...step.data);
				} else if (step.op === "replace") {
					d[step.offs] = d[step.offs].replace(step.find, step.replace);
				} else if (step.op === "move") {
					var tmp = d.splice(step.from, 1)[0];
					d.splice(step.to, 0, tmp);
				} else if (step.op === "intFormat") {
					//	used by BingoAllRegionsExcept v0.85
					if (!isNaN(parseInt(d[step.offs])))
						d[step.offs] = step.before + String(parseInt(d[step.offs])) + step.after;
				} else {
					throw new TypeError("upgradeDescriptor(): unsupported upgrade operation: " + step.op);
				}
			}
		}
		iterations++;
	} while (d.length != l && iterations < 1000);
	if (iterations >= 1000) console.log("upgradeDescriptor(): breaking out of long loop.");
	return d;
}

/**
 *	Checks that the challenge descriptor part s is a valid SettingBox,
 *	matching the specified template.
 *	@param s  string to validate
 *	@param template  object of the form:
 *	{
 *		datatype: "System.Int32",	//	Field type; acceptable values: "System.Boolean", "System.Int32", "System.String"
 *		name: "Amount",   	//	Field label as displayed in the menu
 *		position: "2",    	//	Field position on the menu
 *		formatter: "NULL",	//	Field list name; type System.String: also enum list to check against; Int, Bool: should be "NULL"
 *		altformatter: ""  	//	[System.String type] (optional) alternative list to check against; if the value isn't found in either formatter list, an error is returned
 *		altthreshold: 64  	//	[System.String type] (optional) base index for the altformatter list
 *		ucase: true       	//	[System.String type] (optional) apply toUpperCase() or...
 *		lcase: true       	//	...toLowerCase() to the argument before testing value against alt/formatter
 *		minval: 1,        	//	[System.Int32 type] minimum value
 *		maxval: CHAR_MAX, 	//	[System.Int32 type] maximum value
 *		defaultval: 1     	//	Default value; returned when a valid value can't be found
 *	}
 *	@return object of the form:
 *	{
 *		value: <value>,	//	parsed value, of native type: Boolean (true/false), Number (integer, template.minval to template.maxval inclusive), or String
 *		error: [],     	//	list of strings describing what error(s) occurred
 *		index: <Number>	//	(type System.String) index of the item in its formatter list, or altformatter list + altthreshold; -1 if absent or "NULL"
 *	}
 */
checkSettingBoxEx(s, template) {
	var ar = s.split("|");
	//	number of parameters
	if (ar.length < 5) return { value: template.defaultval, error: ["insufficient parameters"] };
	if (ar.length > 5) return { value: template.defaultval, error: ["excess parameters" ] };
	//	data type
	if (ar[0] !== template.datatype)
		return { value: template.defaultval, error: ["type mismatch"] };
	var rr = { value: template.defaultval, error: [] };
	//	menu parameters
	if (ar[2] !== template.name)
		rr.error.push("name mismatch");
	if (ar[3] !== template.position)
		rr.error.push("position mismatch");
	//	type, and parse the value of that type
	if (ar[0] === "System.Boolean") {
		if (ar[1] === "true")
			rr.value = true;
		else if (ar[1] === "false")
			rr.value = false;
		else {
			rr.error.push("boolean expected, using default");
		}
	} else if (ar[0] === "System.Int32") {
		var num = parseInt(ar[1]);
		if (isNaN(num)) {
			rr.error.push("Int32 value " + ar[1] + " not a number, using default");
		} else if (num > template.maxval) {
			rr.value = template.maxval;
			rr.error.push("Int32 number exceeds maximum");
		} else if (num < template.minval) {
			rr.value = template.minval;
			rr.error.push("Int32 number exceeds minimum");
		} else {
			rr.value = num;
		}
	} else if (ar[0] === "System.String") {
		rr.index = this.enums[template.formatter]?.indexOf(template.defaultval);
		if (template.ucase) ar[1] = ar[1].toUpperCase();
		if (template.lcase) ar[1] = ar[1].toLowerCase();
		//	validate which kind of string it is
		if (template.formatter === "NULL") {
			rr.value = ar[1];	//	raw string
			rr.index = -1;
		} else if (ar[4] !== template.formatter && ar[4] !== template.altformatter) {
			rr.error.push("unexpected list \"" + ar[4] + "\"");
		} else {
			rr.index = (this.enums[template.formatter].indexOf(template.defaultval) >= 0) ? (this.enums[template.formatter].indexOf(template.defaultval)) : (this.enums[template.altformatter]?.indexOf(template.defaultval) + (template.altthreshold || 0));
			var idx1 = this.enums[template.formatter].indexOf(ar[1]);
			var idx2 = this.enums[template.altformatter]?.indexOf(ar[1]) || -1;
			if (idx1 < 0 && idx2 < 0) {
				rr.error.push("value not found in list, using default");
			} else {
				rr.value = ar[1];
				rr.index = (idx1 >= 0) ? idx1 : (idx2 + (template.altthreshold || 0));
			}
		}
	} else {
		rr.error.push("unknown type \"" + ar[0] + "\"");
	}
	if (ar[0] !== "System.String" && ar[4] !== "NULL")
		rr.error.push("list mismatch \"" + ar[4] + "\"");
	return rr;
}

/**
 *	Parses a text-format challenge parameter list, according to the
 *	specified parameter template.
 *	@param desc      parameter list / descriptor; plain_text.split("><")
 *	@param template  array of the form:
 *	[
 *		{ param: "setting1", type: "string", formatter: "enum1",
 *				parse: "SettingBox", parseFmt: (*) },
 *		{ param: "number2",  type: "number", formatter: "",
 *				parse: "parseInt", defaultval: 0 },
 *		{ param: "list3",    type: "list",   formatter: "enum2",
 *				parse: "list", separator: "|", defaultval: "" }
 *		{ param: "dict4",    type: "list",   formatter: "",
 *				parse: "list", separator: "%", defaultval: "empty" }
 *	]
 *	Each descriptor element is processed pairwise with each template
 *	element in order; thus .split("><").length == template.length.
 *
 *	Some template properties are common:
 *		param     	string, name of property this parameter will be assigned to
 *		          	(and similarly in ._error and ._templates)
 *		type      	string, primitive type assigned to [param], one of "bool",
 *		          	"number", "string" or "list"; provides formatting hint to
 *		          	param list consumers ("list" is used for an array of string
 *		          	elements, verbatim when formatter: "", else selected from
 *		          	this.enums[formatter])
 *		formatter 	string, name of enum list (in this.enums) to select from
 *		          	(for types "string", "list"), or "" for arbitrary string
 *		parse     	parser used to extract the value; one of "parseInt",
 *		          	"bool", "intBool", "string", "SettingBox", "list" or "desc"
 *		          	("desc" is used by itself and only for BingoChallenge)
 *		defaultval	default value (of native type) stored in param if text
 *		          	cannot be parsed, or for initialization
 *		minval    	int: minimum clamping value; list: if less than this many
 *		          	elements, use defaultval instead
 *		maxval    	maximum clamping value of int type
 *	additional properties depend on type:
 *		parseFmt 	for SettingBox parser; object is passed to checkSettingBoxEx
 *		         	(see its comment for more information)
 *		separator 	for list parser; delimiter string (i.e., .split(separator))
 *
 *	@return Object of the form:
 *	{
 *		[...param...]: <properties with native type>,
 *		_error: {
 *			[...param...]: ["list of error strings"]
 *		},
 *		_templates: {
 *			[...param...]: (reference to template that produced the param)
 *		}
 *	}
 */
challengeTextToAbstract(desc, template) {
	var params = { _error: {}, _templates: {} }, tmp;
	if (template.length == 1 && template[0].parse === "desc") {
		//	special case for BingoChallenge template
		tmp = desc.join("><");
		if (template[0].maxval)
			tmp = tmp.substring(0, template[0].maxval);
		params[template[0].param] = tmp;
		return params;
	}
	if (desc.length != template.length) throw new TypeError("found " + desc.length + " parameters, expected " + template.length);
	for (var i = 0; i < template.length; i++) {
		params[template[i].param] = template[i].defaultval;
		params._error[template[i].param] = [];
		params._templates[template[i].param] = template[i];
		if (template[i].parse === "parseInt") {
			tmp = parseInt(desc[i]);
			if (isNaN(tmp)) {
				params._error[template[i].param].push("not a number, using default");
			} else {
				if (tmp > template[i].maxval) {
					params[template[i].param] = template[i].maxval;
					params._error[template[i].param].push("number exceeds maximum");
				} else if (tmp < template[i].minval) {
					params[template[i].param] = template[i].minval;
					params._error[template[i].param].push("number exceeds minimum");
				} else {
					params[template[i].param] = tmp;
				}
			}
		} else if (template[i].parse === "bool") {
			if (desc[i] === "true")
				params[template[i].param] = true;
			else if (desc[i] === "false")
				params[template[i].param] = false;
			else
				params._error[template[i].param].push("not a boolean, using default");
		} else if (template[i].parse === "intBool") {
			tmp = parseInt(desc[i]);
			if (isNaN(tmp)) {
				params._error[template[i].param].push("not a number, using default");
			} else {
				params[template[i].param] = (tmp != 0);	//	in practice, only 0 or 1 are used, but we'll accept any nonzero as true
			}
		} else if (template[i].parse === "string") {
			params[template[i].param] = desc[i];
		} else if (template[i].parse === "SettingBox") {
			tmp = this.checkSettingBoxEx(desc[i], template[i].parseFmt);
			params[template[i].param] = tmp.value;
			params._error[template[i].param].splice(-1, 0, ...tmp.error);
		} else if (template[i].parse === "list") {
			tmp = desc[i].split(template[i].separator);
			if (tmp.length == 1 && tmp[0] === "")
				params[template[i].param] = [];
			else if (template[i].formatter === "") {
				params[template[i].param] = tmp;
			} else {
				params[template[i].param] = [];
				tmp.forEach(s => {
					if (this.enumToValue(s, template[i].formatter) == 0)
						params._error[template[i].param].push("\"" + s + "\" not found in enum, ignoring");
					else
						params[template[i].param].push(s);
				});
			}
			if (params[template[i].param].length < template[i].minval) {
				params[template[i].param] = Array.from(template[i].defaultval);	//	make copy of template
				params._error[template[i].param].push("count less than minimum, using default");
			}
		} else {
			console.log("unsupported parse operation: " + template[i].parse);
		}
	}
	return params;
}

/**
 *	Parse a board in text format.
 *	Properties not set in the board string, are left undefined.
 *
 *	Sets this.board = {
 *		comments: <string>, 	//	board title (undefined if absent)
 *		character: <string>,	//	one of this.enums.characters[].text
 *		perks: <int>,       	//	bitmask of BingoEnum_PERKS (undefined if absent)
 *		shelter: <string>,  	//	starting shelter (undefined if absent)
 *		size: <int>,
 *		width: <int>,       	//	for now, width = height = size, but this allows
 *		height: <int>,      	//	support of rectangular grids in the future
 *		goals: [
 *			{
 *				name: "BingoGoalName", // name of CHALLENGES method which produced it
 *				params: { * },
 *				category: <string>,
 *				items: [<string>, ...],
 *				values: [<string>, ...],
 *				description: <string>,
 *				comments: <string>,
 *				paint: [
 *					//	see drawSquare(); any of the following, in any order:
 *					{ type: "icon", value: <string>, scale: <number>, color: <HTMLColorString>, rotation: <number> },
 *					{ type: "break" },
 *					{ type: "text", value: <string>, color: <HTMLColorString> },
 *				],
 *				bin: <Uint8Array>	//	binary format of goal
 *			},
 *			(...)
 *		],
 *		text: <string>,      	//	text format of whole board, including meta supported by current version
 *		srcText: <string>,   	//	original text (if applicable)
 *		bin: <Uint8Array>,   	//	binary format of whole board, including meta and concatenated goals
 *		srcBin: <Uint8Array>,	//	original binary (if applicable)
 *		error: <string>      	//	a text description of any errors that occurred on parsing
 *	}
 *
 *	*params is a (for now) optional property, applicable to refactored
 *	CHALLENGES methods.  It has properties named in the method's parameter
 *	templates, and four built-in properties:
 *		_error    	Properties named by template; an entry is an array of
 *		          	strings, indicating warning/error encountered when
 *		          	parsing the goal.
 *		_name     	String, name of the challenge that produced it
 *		_templates	Properties named by template; references the respective
 *		          	template that generated that property.
 */
parseText(s) {
	var goals = s.split(/bChG/);
	goals.forEach((s, i) => goals[i] = s.trim());
	var size = Math.ceil(Math.sqrt(goals.length));
	this.board = {
		comments: "",
		character: "",
		perks: undefined,
		shelter: "",
		size: size,
		width: size,
		height: size,
		goals: [],
		bin: undefined,
		srcBin: undefined,
		text: undefined,
		srcText: s,
		error: ""
	};

	//	Detect board version:
	//	assertion: no challenge names are shorter than 14 chars (true as of 1.25)
	//	assertion: no character names are longer than 10 chars (true of base game + Downpour + Watcher)
	//	1.27+: character prefix, ";" delimited --> check within first 12 chars
	//	0.90: character prefix, ";" delimited --> check within first 12 chars
	//	0.86: character prefix, "_" delimited --> check within first 12 chars
	//	0.85: no prefix, gonzo right into the goal list --> first token (to "~") is valid goal name or error
	var semicolon = goals[0].indexOf(";"), underscore = goals[0].indexOf("_");
	if (goals[0].search(/[A-Za-z]{1,12}[_;]/) == 0) {
		//	Seems 0.86 or later, find which
		if (semicolon > 0) {
			var secondcolon = goals[0].indexOf(";", semicolon + 1);
			if (secondcolon > 0) {
				this.board.version = "1.3";
				var header = goals[0].split(";");
				this.board.character = header[0];
				this.board.shelter = header[1];
				goals[0] = header[header.length - 1];
				// future up-version checks here: perks, etc.
			} else {
				this.board.version = "0.90";
				this.board.character = goals[0].substring(0, semicolon);
				goals[0] = goals[0].substring(semicolon + 1);
			}
		} else if (underscore > 0) {
			this.board.version = "0.86";
			this.board.character = goals[0].substring(0, underscore);
			goals[0] = goals[0].substring(underscore + 1);
		}
		this.board.character = this.maps.characters.find(o => o.name === this.board.character)?.text || "";
	} else {
		this.board.version = "0.85";
	}

	if (goals.length == 1 && goals[0].length == 0) {
		this.board.goals.push(this.textToGoal("BingoChallenge~Empty board"));
	} else {
		for (var i = 0; i < goals.length; i++) {
			var g = undefined;
			try {
				g = this.textToGoal(goals[i]);
			} catch (e) {
				g = this.textToGoal("BingoChallenge~" + e.message + "," + goals[i].replace("~", ","));
			}
			if (g !== undefined) {
				this.board.goals.push(g);
				var er = this.goalErrToString(g);
				if (er > "")
					this.board.error += "\nGoal " + String(i) + ", " + er;
			}
		}
	}
	this.board.error = this.board.error.substring(1);

	//	Regenerate the binary and text formats and we're done
	this.boardToBin();
	this.boardToText();
}

/**
 *	Formats a goal's _error object contents into a string.
 *	@param g  goal to read
 */
goalErrToString(g) {
	var e = g.params?._error, k, s = "", i;
	if (e === undefined) return s;
	k = Object.keys(e);
	for (i = 0; i < k.length; i++) {
		if (e[k[i]].length > 0) {
			if (s.length > 0)
				s += "; ";
			s += k[i] + ": " + e[k[i]].join("; ");
		}
	}
	if (s.length > 0)
		s = g.params._name + ": " + s;
	return s;
}

/**
 *	Regenerates binary format from this.board to this.board.bin.
 *	A header is created, then goal bin snippets are concatenated
 *	together.
 *	board must be initialized, including metadata, and goals with
 *	valid bin snippets.
 */
boardToBin() {
	var e = new TextEncoder();
	var hdr = new Uint8Array(HEADER_LENGTH);
	var comm = e.encode(this.board.comments + "\u0000");
	var shelter = e.encode(this.board.shelter + "\u0000");

	const MODPACK = {
		END:  0,
		PACK: 1
	};
	var a = [];
	var enc = new TextEncoder();
	for (var i = 0; i < this.modpacks.length; i++) {
		a.push(MODPACK.PACK);
		a.push(this.modpacks[i].data.length);
		for (var j = 0; j < 32; j += 8)
			a.push((this.modpacks[i].hash >> j) & 0xff);
		a.push(...this.modpacks[i].data);
	}
	a.push(MODPACK.END);
	var mods = new Uint8Array(a);
	//	struct bingo_header_s {
	//	uint32_t magicNumber;
	Bingovista.applyLong(hdr, 0, 0x69427752); 	//	"RwBi" = Rain World BIngo board
	//	uint8_t version_major; uint8_t version_minor;
	hdr[4] = VERSION_MAJOR; hdr[5] = VERSION_MINOR;
	//	uint8_t boardWidth; uint8_t boardHeight;
	hdr[6] = this.board.width; hdr[7] = this.board.height;
	//	uint8_t character;
	hdr[8] = this.maps.characters.findIndex(o => o.text === this.board.character) + 1;
	//	uint16_t shelter;
	Bingovista.applyShort(hdr, 9, hdr.length + comm.length);
	//	uint32_t perks;
	Bingovista.applyLong(hdr, 11, this.board.perks);
	//	uint16_t goals;
	Bingovista.applyShort(hdr, 15, hdr.length + comm.length + shelter.length + mods.length);
	//	uint16_t mods;
	Bingovista.applyShort(hdr, 17, ((this.modpacks.length > 0) ? hdr.length + comm.length + shelter.length : 0));
	//	uint16_t reserved;
	Bingovista.applyShort(hdr, 19, 0);
	//	uint8_t[] comments;
	//	};
	var gLen = 0;
	for (var i = 0; i < this.board.goals.length; i++) {
		gLen += this.board.goals[i].bin.length;
	}
	gLen += hdr.length + comm.length + shelter.length + mods.length;
	//gLen = Math.ceil(gLen / 3) * 3;	//	round up to pad with zeroes; no effect on board, removes base64 padding
	var r = new Uint8Array(gLen);
	var offs = 0;
	r.set(hdr, offs); offs += hdr.length;
	r.set(comm, offs); offs += comm.length;
	r.set(shelter, offs); offs += shelter.length;
	r.set(mods, offs); offs += mods.length;
	for (var i = 0; i < this.board.goals.length; i++) {
		r.set(this.board.goals[i].bin, offs); offs += this.board.goals[i].bin.length;
	}
	this.board.bin = r;
}

/**
 *	Converts binary format to an abstract board object.
 */
binToBoard(a) {
	//	Minimum size to read full header
	if (a.length < HEADER_LENGTH)
		throw new TypeError("binToBoard: insufficient data, found " + String(a.length) + ", expected: " + String(HEADER_LENGTH) + " bytes");
	//	[0] uint32_t magicNumber;
	if (Bingovista.readLong(a, 0) != 0x69427752)
		throw new TypeError("binToBoard: unknown magic number: 0x" + Bingovista.readLong(a, 0).toString(16) + ", expected: 0x69427752");
	//	[6, 7] uint8_t boardWidth; uint8_t boardHeight;
	this.board = {
		comments: "",
		character: "",
		perks: 0,
		shelter: "",
		size: a[6],	//	for now, width = height = size, so the source of this assignment doesn't matter
		width: a[6],
		height: a[7],
		text: "",
		srcText: undefined,
		goals: [],
		bin: a,
		srcBin: a,
		error: ""
	};
	var d = new TextDecoder;
	//	[4, 5] uint8_t version_major; uint8_t version_minor;
	if (((a[4] << 8) + a[5]) > (VERSION_MAJOR << 8) + VERSION_MINOR)
		this.board.error = "Warning: board version " + String(a[4]) + "." + String(a[5])
				+ " is newer than viewer v" + String(VERSION_MAJOR) + "." + String(VERSION_MINOR)
				+ "; some goals or features may be unsupported.";
	//	[8] uint8_t character;
	this.board.character = (a[8] <= 0) ? "Any" : this.maps.characters[a[8] - 1].text;

	//	[15] = uint16_t goals;	//	out of order as we need these sooner
	var goalOffs = Bingovista.readShort(a, 15);
	if (goalOffs < HEADER_LENGTH || goalOffs >= a.length)
		throw new TypeError("binToBoard: goals pointer 0x" + goalOffs.toString(16) + " out of bounds");

	//	[17] = uint16_t mods;
	var modOffs = Bingovista.readShort(a, 17);
	if (modOffs != 0) {
		if (modOffs < HEADER_LENGTH)
			throw new TypeError("binToBoard: mods pointer 0x" + modOffs.toString(16) + " inside header");
		if (modOffs >= a.length)
			throw new TypeError("binToBoard: mods pointer 0x" + modOffs.toString(16) + " out of bounds");
		if (modOffs >= goalOffs)
			throw new TypeError("binToBoard: mods pointer 0x" + modOffs.toString(16) + " inside goals list");
	}

	//	[9] uint16_t shelter;
	var shelOffs = Bingovista.readShort(a, 9);
	if (shelOffs > 0) {
		if (shelOffs < HEADER_LENGTH)
			throw new TypeError("binToBoard: shelter pointer 0x" + shelOffs.toString(16) + " inside header");
		if (shelOffs >= a.length)
			throw new TypeError("binToBoard: shelter pointer 0x" + shelOffs.toString(16) + " out of bounds");
		var shlEnd = a.indexOf(0, shelOffs);
		if (shlEnd < 0)
			throw new TypeError("binToBoard: shelter string missing terminator");
		if (shlEnd >= goalOffs)
			throw new TypeError("binToBoard: shelter string overlapping goals");
		if (modOffs > 0 && shlEnd >= modOffs)
			throw new TypeError("binToBoard: shelter string overlapping mods");
		this.board.shelter = d.decode(a.subarray(shelOffs, a.indexOf(0, shelOffs)));
	}
	//	[11] uint32_t perks;
	this.board.perks = Bingovista.readLong(a, 11);
	//	[19] uint16_t reserved;
	if (Bingovista.readShort(a, 19) != 0)
		throw new TypeError("binToBoard: reserved: 0x" + Bingovista.readShort(a, 19).toString(16) + ", expected: 0x0");
	//	(21) uint8_t[] comments;
	if (a.indexOf(0, HEADER_LENGTH) < 0 || a.indexOf(0, HEADER_LENGTH) >= (modOffs || goalOffs))
		throw new TypeError("binToBoard: comments missing terminator");
	this.board.comments = d.decode(a.subarray(HEADER_LENGTH, a.indexOf(0, HEADER_LENGTH)));

	if (modOffs > 0) {
		const MODPACK = {
			END:  0,
			PACK: 1
		};
		var modNum = 0;
		this.modpacks = [];
		for (; modOffs < goalOffs;) {
			if (a[modOffs] == MODPACK.END) {
				if (modOffs == Bingovista.readShort(a, 17)) {
					throw new TypeError("binToBoard: empty modpack at offset 0x" + modOffs.toString(16));
				}
				break;
			} else if (a[modOffs] > MODPACK.PACK) {
				throw new TypeError("binToBoard: unknown modpack type " + a[modOffs] + " at offset 0x" + modOffs.toString(16) + ", modpack " + modNum);
			}
			if (modOffs + 6 > goalOffs) {
				throw new TypeError("binToBoard: unexpected EOL in modpack header at offset 0x" + modOffs.toString(16) + ", modpack " + modNum);
			}
			if (modOffs + 6 + a[modOffs + 1] > goalOffs) {
				throw new TypeError("binToBoard: unexpected EOL in modpack body at offset 0x" + modOffs.toString(16) + ", modpack " + modNum);
			}
			var modpack = { hash: Bingovista.readLong(a, modOffs + 2), data: a.subarray(modOffs + 6, modOffs + 6 + a[modOffs + 1]) };
			modpack.name = this.identifyModpack(modpack.hash);
			this.modpacks.push(modpack);
			modNum++;
			modOffs += 6 + a[modOffs + 1];
		}

		//	load mods here
	}

	//	do mod-dependent validation checks here
	if (a[8] > this.maps.characters.length)
		throw new TypeError("binToBoard: character " + a[8] + " out of bounds");

	var goal, type, desc;
	for (var i = 0; i < this.board.width * this.board.height && goalOffs < a.length; i++) {
		var sa = a.subarray(goalOffs, goalOffs + a[goalOffs + 2] + GOAL_LENGTH);
		if (sa.length < GOAL_LENGTH) break;
		try {
			goal = this.binToGoal(sa);
		} catch (er) {
			goal = this.textToGoal("BingoChallenge~Unknown goal, [" + sa.join(",") + "]");
		}
		goalOffs += GOAL_LENGTH + a[goalOffs + 2];
		this.board.goals.push(goal);
		var er = this.goalErrToString(goal);
		if (er > "")
			this.board.error += "\nGoal " + String(i) + ", " + er;
	}
	this.board.error = this.board.error.substring(1);
	//	Regenerate the binary and text formats and we're done
	this.boardToBin();
	this.boardToText();
}

boardToText() {
	this.board.text = (this.maps.characters.find(o => o.text === this.board.character)?.name || "Any") + ";";
	this.board.text += (this.board.shelter === "" ? "random" : this.board.shelter) + ";";
	for (var i = 0; i < this.board.goals.length; i++) {
		this.board.text += this.board.goals[i].text + "bChG";
	}
	this.board.text = this.board.text.replace(/bChG$/, "");
}

goalToPaint(g) {
	return this.CHALLENGE_DEFS[this.challengeValue(g.name)].toPaint.call(this, g.params);
}

goalToDesc(g) {
	return this.CHALLENGE_DEFS[this.challengeValue(g.name)].toDesc.call(this, g.params);
}

goalToComment(g) {
	return this.CHALLENGE_DEFS[this.challengeValue(g.name)].toComment.call(this, g.params);
}

goalToBinary(g) {
	return this.CHALLENGE_DEFS[this.challengeValue(g.name)].toBinary.call(this, g.params);
}

goalToText(g) {
	var def = this.CHALLENGE_DEFS[this.challengeValue(g.name)];
	var t = def.template;
	var desc = Array(t.length);
	for (var i = 0; i < t.length; i++) {
		var p = g.params[t[i].param];
		if (t[i].parse === "parseInt") {
			desc[i] = Number(p).toString(10);
		} else if (t[i].parse === "bool") {
			desc[i] = p ? "true" : "false";
		} else if (t[i].parse === "intBool") {
			desc[i] = p ? "1" : "0";
		} else if (t[i].parse === "string" || t[i].parse === "desc") {
			desc[i] = p;
		} else if (t[i].parse === "SettingBox") {
			desc[i] = p;
			if (t[i].parseFmt.datatype === "System.Boolean") {
				desc[i] = p ? "true" : "false";
			} else if (t[i].parseFmt.datatype === "System.Int32") {
				desc[i] = Number(p).toString(10);
			}
			desc[i] = t[i].parseFmt.datatype + "|" + desc[i] + "|" + t[i].parseFmt.name +
					"|" + t[i].parseFmt.position + "|" + t[i].parseFmt.formatter;
		} else if (t[i].parse === "list") {
			desc[i] = p.join(t[i].separator);
		} else {
			console.log("unsupported parse operation: " + t[i].parse);
		}
	}
	desc = Bingovista.upgradeDescriptor(desc, def.textDowngrade);
	return def.name + "~" + desc.join("><");
}

textToGoal(s) {
	var type, desc;
	var tildeSplit = s.split("~");
	if (tildeSplit.length != 2)
		throw new TypeError("Expected 2 sections, found " + String(tildeSplit.length));
	if (this.challengeUpgrades[tildeSplit[0]] !== undefined)
		tildeSplit[0] = this.challengeUpgrades[tildeSplit[0]];
	type = this.challengeValue(tildeSplit[0]);
	if (type < 0)
		throw new TypeError("Unknown goal, " + tildeSplit[0]);
	desc = tildeSplit[1].split("><");
	var def = this.CHALLENGE_DEFS[type];
	//	def properties: name, category, super, textUpgrade, template, toPaint, toDesc, toComment, toBinary
	if (def.super !== undefined) {
		//	is a subclass; refer to parent for template and methods
		type = this.challengeValue(def.super);
		if (type < 0)
			throw new TypeError("Unknown superclass in " + def.name + ": " + def.super);
		def = this.CHALLENGE_DEFS[type];
	}
	desc = Bingovista.upgradeDescriptor(desc, def.textUpgrade);
	var params = this.challengeTextToAbstract(desc, def.template);
	params._name = def.name;
	var goal = {
		name: def.name,
		params: params,
		category: def.category,
		items: def.template.map(o => o.param),
		values: def.template.map(o => 
				((o.parse === "list") ?
				String(params[o.param].join(o.separator)) :
				String(params[o.param]))
				),
		paint: def.toPaint.call(this, params),
		description: def.toDesc.call(this, params),
		comments: def.toComment.call(this, params),
		bin: def.toBinary.call(this, params)
	};
	goal.text = this.goalToText(goal);
	return goal;
}

/**
 *	Reads the given [sub]array as a binary challenge:
 *	struct bingo_goal_s {
 *		uint8_t type;   	//	BINGO_GOALS index
 *		uint8_t flags;  	//	GOAL_FLAGS bit vector
 *		uint8_t length; 	//	Length of data[]
 *		uint8_t[] data; 	//	defined by the goal
 *	};
 *	and outputs the corresponding abstract goal structure.
 */
binToGoal(c) {
	var def, supr, p, i, j, t, tmp, pt, maxIdx, params = { _error: {}, _templates: {} };
	var d = new TextDecoder;

	if (c[0] >= this.CHALLENGE_DEFS.length)
		throw new TypeError("binToGoal: unknown challenge type " + String(c[0]));
	def = this.CHALLENGE_DEFS[c[0]];
	//	def properties: name, category, super, textUpgrade, template, toPaint, toDesc, toComment, toBinary
	params._name = def.name;
	if (def.super !== undefined) {
		//	Populate params with default values from the superclass;
		//	subclass template specifies serialized binary params only
		params._name = def.super;
		supr = this.CHALLENGE_DEFS[this.challengeValue(def.super)]
		t = supr.template;
		for (i = 0; i < t.length; i++) {
			p = t[i].param;
			params[p] = (t[i].parse === "SettingBox") ?
					t[i].parseFmt.defaultval : t[i].defaultval;
			params._error[p] = [];
			params._templates[p] = t[i];
		}
	}
	t = def.template;
	for (i = 0; i < t.length; i++) {
		p = t[i].param;
		params[p] = (t[i].parse === "SettingBox") ?
				t[i].parseFmt.defaultval : t[i].defaultval;
		params._error[p] = [];
		params._templates[p] = t[i];
		pt = t[i].binType;
		if (pt === "number") {
			//	Number, possibly keying an enum
			tmp = 0;
			for (j = 0; j < t[i].binSize; j++) {
				//	little-endian, variable byte length, unsigned integer
				tmp += c[GOAL_LENGTH + t[i].binOffs + j] * (1 << (8 * j));
			}
			//	cast to type
			if (t[i].signed) {	//	implicit type === "number" and formatter === ""
				if (tmp >= (2 ** (j * 8 - 1)))
					tmp = tmp - (2 ** (j * 8));
			}
			if (t[i].formatter > "") {	//	implicit type === "string"
				tmp = formatVal.call(this, tmp, t[i], params._error[p]);
			} else if (t[i].type === "string") {	//	string, no formatter; plain number in text format
				tmp = String(tmp);
			}
			if (tmp !== undefined) params[p] = tmp;
		} else if (pt === "bool") {
			//	Boolean: reads one bit at the specified offset and position
			//	Note: offset includes goal's hidden flag for better packing when few flags are needed
			params[p] = ((c[1 + t[i].binOffs] >> t[i].bit) & 0x01) == 0x01;
		} else if (pt === "string" || pt === "pstr") {
			//	Plain string: copies a fixed-length or zero-terminated string into its replacement template site(s)
			var offs = GOAL_LENGTH + t[i].binOffs;
			if (pt === "pstr") {
				//	Pointer to string: reads a (byte) offset from target location, then copies from that offset
				offs = GOAL_LENGTH + c[offs];
			}
			if (t[i].binSize == 0) {
				maxIdx = c.indexOf(0, offs);
				if (maxIdx == -1)
					maxIdx = c.length;
			} else {
				maxIdx = t[i].binSize + offs;
			}
			if (t[i].formatter > "") {
				params[p] = Array.from(t[i].defaultval);
				tmp = [];
				for (j = offs; j < maxIdx; j++) {
					var tmp2 = formatVal.call(this, c[j], t[i], params._error[p]);
					if (tmp2 !== undefined) tmp.push(tmp2);
				}
				if (tmp.length > 0 || params._error[p].length == 0)
					params[p] = tmp;
			} else {
				params[p] = d.decode(c.subarray(offs, maxIdx));
			}
		}
	}

	//	Note that subclass / -Ex version challenges can use different formatter
	//	than super; this is necessary to support more diverse binary encodings
	function formatVal(val, template, err) {
		var alt = template.altthreshold, alf = template.altformatter;
		if (template.parse === "SettingBox") {
			alt = template.parseFmt.altthreshold;
			alf = template.parseFmt.altformatter;
		}
		if (alt === undefined || val < alt) {
			if (val > this.enums[template.formatter].length)
				err.push("index " + String(val - 1) + " out of bounds");
			else
				return this.enums[template.formatter][val - 1];
		} else {
			if (this.enums[alf][val - alt] === undefined)
				err.push("altformatter \"" + alt + "\", index " + String(val - alt) + " out of bounds");
			else
				return this.enums[alf][val - alt];
		}
		return undefined;
	}

	if (def.super !== undefined)
		def = supr;
	var goal = {
		name: def.name,
		params: params,
		category: def.category,
		items: def.template.map(o => o.param),
		values: def.template.map(o =>
				((o.parse === "list") ?
				String(params[o.param].join(o.separator)) :
				String(params[o.param]))
				),
		paint: def.toPaint.call(this, params),
		description: def.toDesc.call(this, params),
		comments: def.toComment.call(this, params),
		bin: def.toBinary.call(this, params),
		text: undefined
	};
	goal.text = this.goalToText(goal);
	return goal;
}

/**
 *	Reads the given [sub]array as a binary challenge:
 *	struct bingo_goal_s {
 *		uint8_t type;   	//	BINGO_GOALS index
 *		uint8_t flags;  	//	GOAL_FLAGS bit vector
 *		uint8_t length; 	//	Length of data[]
 *		uint8_t[] data; 	//	defined by the goal
 *	};
 *	and outputs the corresponding text formatted goal.
 */
binToGoalOld(c) {
	var s, p, j, k, outputs, stringtype, maxIdx, replacer, tmp;
	var d = new TextDecoder;

	if (c[0] >= this.BINARY_TO_STRING_DEFINITIONS.length)
		throw new TypeError("binToGoal: unknown challenge type " + String(c[0]));
	//	ignore flags, not supported in 0.90 text
	//c[1]
	s = this.BINARY_TO_STRING_DEFINITIONS[c[0]].desc;
	p = this.BINARY_TO_STRING_DEFINITIONS[c[0]].params;
	//	extract parameters and make replacements in s
	for (j = 0; j < p.length; j++) {
		stringtype = false;

		if (p[j].type === "number") {
			//	Plain number: writes a decimal integer into its replacement template site(s)
			outputs = [0];
			for (k = 0; k < p[j].size; k++) {
				//	little-endian, variable byte length, unsigned integer
				outputs[0] += c[GOAL_LENGTH + p[j].offset + k] * (1 << (8 * k));
			}
			if (p[j].signed && p[j].formatter == "" && outputs[0] >= (2 ** (k * 8 - 1)))
				outputs[0] = outputs[0] - (2 ** (k * 8));

		} else if (p[j].type === "bool") {
			//	Boolean: reads one bit at the specified offset and position
			//	Note: offset includes goal's hidden flag for better packing when few flags are needed
			outputs = [(c[1 + p[j].offset] >> p[j].bit) & 0x01];
			if (p[j].formatter !== "")
				outputs[0]++;	//	hack for formatter offset below

		} else if (p[j].type === "string") {
			//	Plain string: copies a fixed-length or zero-terminated string into its replacement template site(s)
			stringtype = true;
			if (p[j].size == 0) {
				maxIdx = c.indexOf(0, GOAL_LENGTH + p[j].offset);
				if (maxIdx == -1)
					maxIdx = c.length;
			} else
				maxIdx = p[j].size + GOAL_LENGTH + p[j].offset;
			outputs = c.subarray(GOAL_LENGTH + p[j].offset, maxIdx);

		} else if (p[j].type === "pstr") {
			//	Pointer to string: reads a (byte) offset from target location, then copies from that offset
			stringtype = true;
			if (p[j].size == 0) {
				maxIdx = c.indexOf(0, GOAL_LENGTH + c[p[j].offset + GOAL_LENGTH]);
				if (maxIdx == -1)
					maxIdx = c.length;
			} else
				maxIdx = p[j].size + GOAL_LENGTH + c[p[j].offset + GOAL_LENGTH];
			outputs = c.subarray(GOAL_LENGTH + c[p[j].offset + GOAL_LENGTH], maxIdx);
		}

		var f = p[j].formatter;
		if (f === "") {
			if (stringtype) {
				//	Unformatted string, decode bytes into utf-8
				replacer = d.decode(outputs);
			} else {
				//	single number, toString it
				replacer = String(outputs[0]);
			}
		} else {
			//	Formatted number/array, convert it and join
			if (this.enums[f] === undefined)
				throw new TypeError("binToGoal: formatter \"" + f + "\" not found");
			tmp = [];
			for (k = 0; k < outputs.length; k++) {
				if (p[j].altthreshold === undefined || outputs[k] < p[j].altthreshold) {
					if (this.enums[f][outputs[k] - 1] === undefined)
						throw new TypeError("binToGoal: formatter \"" + f + "\", value out of range: " + String(outputs[k]));
					tmp.push(this.enums[f][outputs[k] - 1]);
				} else {
					if (this.enums[p[j].altformatter][outputs[k] - p[j].altthreshold] === undefined)
						throw new TypeError("binToGoal: alternative formatter \"" + p[j].altformatter + "\", value out of range: " + String(outputs[k]));
					tmp.push(this.enums[p[j].altformatter][outputs[k] - p[j].altthreshold]);
				}
			}
			replacer = tmp.join(p[j].joiner || "");
		}
		s = s.replace(RegExp("\\{" + String(j) + "\\}", "g"), replacer);
	}
	s =
			(this.challengeUpgrades[this.BINARY_TO_STRING_DEFINITIONS[c[0]].name]
			|| this.BINARY_TO_STRING_DEFINITIONS[c[0]].name)
			+ "~" + s;
	return s;
}


/**                              *
 * * * Challenge Definitions * * *
 *                              **/

/**
 *	TODO: sync comments
 *	was: CHALLENGES[] methods
 *	is now: packed into definitions objects with binary formatting.
 *	====
 *
 *	Challenge classes; used by parseText().
 *	From Bingomod decomp/source, with some customization (particularly across
 *	versions).
 *
 *	Adding new challenges:
 *	Append at the bottom. Yeah, they're not going to be alphabetical order anymore.
 *	Order is used by challengeValue, and thus translate names to binary identifier;
 *	to minimize changes in binary format, preserve existing ordering when possible.
 *
 *	Modifying existing challenges:
 *	Where possible, preserve compatibility between formats, auto-detect differences,
 *	or use this.board.version to select method when not otherwise suitable.
 *	Reference hacks for example: BingoDamageChallenge / BingoDamageExChallenge,
 *	etc.  See: challengeUpgrades and BINARY_TO_STRING_DEFINITIONS.
 *
 *	Maintain sync between CHALLENGES, BINARY_TO_STRING_DEFINITIONS and
 *	BingoEnum_CHALLENGES.
 *
 *	@param desc   list of goal parameters to parse (goal_text.split("><"))
 *	@return (collection of board info outputs)
 */

/**
 *	TODO: sync this comment to what the actual stuff is
 *	was: BINARY_TO_STRING_DEFINITIONS[]
 *	====
 *
 *	CHALLENGE_DEFS entries have these properties:
 *	{
 *		name: "BingoGoalChallenge",	//	name of the challenge as stored in text format
 *		category: "A category",	//	category text
 *		super: "BingoParentChallenge",	//	if an -Ex challenge
 *		textUpgrade: {
 *			//	upgrade objects (for challenges with multiple versions)
 *		},
 *		textDowngrade: {
 *			//	downgrade objects (for challenges with deprecated params)
 *		},
 *		template: [
 *			//	template objects, describing all challenge params (type, how to derive from text/bin source, type/how to format, etc.)
 *		],
 *		//	methods to convert abstract goal representation into various outputs
 *		toPaint: function(p) {},
 *		toDesc: function(p) {},
 *		toComment: function(p) {},
 *		toBinary: function(p) {}
 *	}
 *
 *	====
 *
 *	Challenge templates and helper functions.
 *	Indexed with challengeValue().
 *
 *	Entries have this structure:
 *	{
 *		name: "BingoNameOfChallenge",
 *		params: [],
 *		desc: "format{2}string {0} with templates {2} for param values {1}"
 *	}
 *
 *	name is generally of the form /Bingo.*Challenge/, following the in-game
 *	BingoChallenge classes the goals are implemented with.
 *
 *	When a challenge has multiple binary formats, a -"ChallengeEx", -"Ex2",
 *	etc. suffix names the subsequent versions.  These only contain binary
 *	templates and a reference to the superclass; on startup, the remaining
 *	fields are populated from GOAL_DEFINITIONS[this.challengeValue(super)].
 *
 *	desc contains templates, of the form "{" + String(index) + "}", where index
 *	is the index of the params object that produces it.  Templates are expanded
 *	naively via RegExp, in order; avoid nesting them, or "interesting" results
 *	may happen.  Repeat template sites are ignored.  Thus, if `params` 0-2 were
 *	filled out above, it might expand to:
 *	"formatBazstring Foo with templates {2} for param values Bar"
 *
 *	The final goal string is produced as "<name>~<desc>", with desc's template
 *	sites replaced by values produced from respectively numbered params items.
 *	Goals are joined with "bChG" to produce the complete board.
 *
 *	A params object takes the form of these structures:
 *
 *	//	Plain number: writes a decimal integer into its replacement template site(s)
 *	{
 *		type: "number",
 *		offset: 0,      	//	byte offset in goal.data, where to read from (beware: can overlap other fields!)
 *		size: 1,        	//	(1-4) number of bytes to read from binary goal, starting from offset
 *		formatter: ""   	//	Name of an enum to transform each character with, or empty for identity
 *	}
 *
 *	//	Plain string: copies a fixed-length or zero-terminated string (optionally
 *	//	transformed by formatter and joiner) into the matching position in the template
 *	//	string. Note: when formatter === "", UTF-8 decoding is applied, returning a
 *	//	normal JS string in the object.
 *	{
 *		type: "string",
 *		offset: 3,      	//	byte offset to read from
 *		size: 2,        	//	number of bytes to read, or if 0, read until zero terminator or end of goal
 *		formatter: "",  	//	Name of an enum to transform each character with
 *		joiner: ""      	//	String to join characters with
 *	}
 *
 *	//	Pointer to string: reads a (byte) offset from target location, then uses it as
 *	//	an offset (relative to goal data start) pointing to a fixed-length or zero-
 *	//	terminated string; the string is optionally transformed by formatter and joiner;
 *	//	then the result is deposited into the matching position in the template string
 *	{
 *		type: "pstr",
 *		offset: 2,    	//	byte offset to read pointer from
 *		size: 0,      	//	!= 0, length of string, or if 0, read until Z/end
 *		formatter: "",	//	Name of an enum to transform each character with
 *		joiner: ""    	//	String to join characters with
 *	}
 *
 *	//	Boolean: reads one bit at the specified offset and position, then copies the
 *	//	formatter'd value into its replacement template site(s)
 *	{
 *		type: "bool",
 *		offset: 1,   	//	byte offset (starting from goal.flags) to read from
 *		bit: 0,      	//	bit offset within byte (0-7) (note: bits 0-3 of offset 0 are reserved)
 *		formatter: ""	//	Name of an enum to transform the value (0/1) with
 *	}
 *
 *	Where a formatter is specified, a simple num:char or char:char conversion table can be
 *	used, or a multi-character output such as from a namespace enum.  In this way, a string
 *	for example can be expanded into an array of names, separated by delimiters (joiner) to
 *	represent higher-level structures like lists or dictionaries; or a number into an enum,
 *	or a boolean into "false" and "true".  number and bool are scalar so of course don't
 *	have anything to join; `joiner` is unread on those types.
 *
 *	Alternative formatters are possible by specifying altthreshold, a numeric threshold
 *	at which the alternative will be chosen, and altformatter, the name of the alternative
 *	enum.
 *
 *	Special note: because zero may be used for string terminator, and because enums may be
 *	used for both string (array) and scalar (number) data, the actual enum index written is
 *	someEnumArray.indexOf("someString") + 1 for both data types.  Enums with a default or
 *	"any" value shall use a default index of 0 (thus stored as 1 in the binary format).
 *
 *	Note that the last string in a goal can be terminated by the goal object itself, saving
 *	a zero terminator.  Ensure that an implementation captures this behavior safely, without
 *	committing read-beyond-bounds or uninitialized memory access.  A recommended approach
 *	is copying the goal into a temporary buffer, that has been zeroed at least some bytes
 *	beyond the length of the goal being read.  Or use a language which returns zero or null
 *	or throws error for OoB reads.
 */
CHALLENGE_DEFS = [	//	Indexed by binary goal value
	{
		//	Default goal / error placeholder; zero-terminated string container
		name: "BingoChallenge",
		category: "Empty challenge class",	//	headline title shown for the goal (could also be a function for completeness, but no goals required active content here)
		super: undefined,
		//	desc format: custom; see challengeTextToAbstract() "desc"
		textUpgrade: {},
		textDowngrade: {},
		template: [	//	parameter template; builds goal.params object 
			{	//	param 0
				//	See challengeTextToAbstract() comment for defined properties
				param: "text", type: "string", formatter: "",        	//	param name, type, and formatting enum (if any) used in the abstract goal object
				binType: "string", binOffs: 0, binSize: 0,           	//	optional: binary source location and type/method; any parameters lacking these properties will be assigned defaultval
				parse: "desc", minval: 0, maxval: 255, defaultval: ""	//	text parsing, range, and default value (as native type) (for string type, min/max limits length)
			}
		],
		//	Functions converting abstract goal representation to various outputs (goalToString() uses .template)
		toPaint: function(p) {
			//	how the goal is displayed on the board; see drawSquare() for applicable properties
			return [
				{ type: "text", value: "∅", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			/*	HTML allowed in return value (special case: is suppressed for BingoChallenge)  */
			return p.text;
		},
		toComment: function(p) {	//	Comments are mostly static strings, but a few goals have active content so they all have to be a function
			/*	HTML allowed here  */
			return "";
		},
		toBinary: function(p) { 	//	Could drive bin from template, but a few challenges need active content or can save bytes with a more compact format
			var b = new Uint8Array(255 + GOAL_LENGTH);
			b[0] = this.challengeValue(p._name);
			var enc = new TextEncoder().encode(p.text);
			enc = enc.subarray(0, 255);
			b.set(enc, GOAL_LENGTH);
			b[2] = enc.length;
			return b.subarray(0, enc.length + GOAL_LENGTH);
		}
	},
	{
		name: "BingoAchievementChallenge",
		category: "Obtaining Passages",
		//	desc of format ["System.String|Traveller|Passage|0|passage", "0", "0"]
		super: undefined,
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "ID", type: "string", formatter: "passage",
				binType: "number", binOffs: 0, binSize: 1,
				parse: "SettingBox", parseFmt: {	//	For SettingBox, a parseFmt object specifies min/max/default instead
					datatype: "System.String", name: "Passage", position: "0",
					formatter: "passage", defaultval: "Traveller"
				}
			},
			{
				param: "completed", type: "bool", formatter: "",
				parse: "intBool", defaultval: false
			},
			{
				param: "revealed", type: "bool", formatter: "",
				parse: "intBool", defaultval: false
			}
		],
		toPaint: function(p) {
			return [
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.maps.passage.find(o => o.name === p.ID).icon, scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
			];
		},
		toDesc: function(p) {
			return "Earn " + (this.maps.passage.find(o => o.name === p.ID).text || "unknown") + " passage.";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.ID, "passage");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoAllRegionsExceptChallenge",
		category: "Entering regions without visiting one",
		super: undefined,
		//	desc of format ["System.String|UW|Region|0|regionsreal", "SU|HI|DS|CC|GW|SH|VS|LM|SI|LF|UW|SS|SB|LC", "0", "System.Int32|13|Amount|1|NULL", "0", "0"]
		textUpgrade: {
			6: [	//	v0.85
				{ op: "intFormat", offs: 3, before: "System.Int32|", after: "|Amount|1|NULL" }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "region", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "regionsreal", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "0",
					formatter: "regionsreal", defaultval: "SU"
				}
			},
			{
				param: "regionsToEnter", type: "list",
				binType: "string", binOffs: 2, binSize: 0,
				formatter: "regionsreal", parse: "list", separator: "|", minval: 0, maxval: 252, defaultval: []
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
				param: "revealed",  type: "bool",
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
			b.push(0);	//	zero terminator
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoBombTollChallenge",
		category: "Throwing grenades at scavenger tolls",
		super: undefined,
		//	desc of format (< v1.2) ["System.String|gw_c05|Scavenger Toll|1|tolls", "System.Boolean|false|Pass the Toll|0|NULL", "0", "0"]
		//	or (>= 1.2) ["System.Boolean|true|Specific toll|0|NULL", "System.String|gw_c05|Scavenger Toll|3|tolls", "System.Boolean|false|Pass the Toll|2|NULL", "0", "System.Int32|3|Amount|1|NULL", "empty", "0", "0"]
		textUpgrade: {
			4: [	//	< v1.2
				{ op: "splice", offs: 2, rem: 0, data: ["0", "System.Int32|3|Amount|1|NULL", "empty"] },
				{ op: "unshift", data: ["System.Boolean|true|Specific toll|0|NULL"] }
			],
			8: [	//	< v1.268
				{ op: "replace", offs: 5, find: /\|false/g, replace: "|0,0" },
				{ op: "replace", offs: 5, find: /\|true/g, replace: "|0,1" }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "specific", type: "bool",
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Specific toll", position: "0",
					formatter: "NULL", defaultval: true
				}
			},
			{
				param: "roomName", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "tolls", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Scavenger Toll", position: "3",
					formatter: "tolls", lcase: true, defaultval: "su_c02"
				}
			},
			{
				param: "pass", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Pass the Toll", position: "2",
					formatter: "NULL", defaultval: false
				}
			},
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0
			},
			{
				param: "amount", type: "number",
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "1",
					formatter: "NULL", minval: 0, maxval: CHAR_MAX, defaultval: 1
				} 
			},
			{
				param: "bombed", type: "list",
				formatter: "tolls_bombed", parse: "list", separator: "%", minval: 1, defaultval: ["empty"]
			},
			{
				param: "completed", type: "bool", formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "revealed",  type: "bool", formatter: "", parse: "intBool", defaultval: false
			}
		],
		toPaint: function(p) {
			var r = [
				{ type: "icon", value: this.entityIconAtlas("ScavengerBomb"), scale: 1, color: this.entityIconColor("ScavengerBomb"), rotation: 0 },
				{ type: "icon", value: "scavtoll", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: p.specific ? p.roomName.toUpperCase() : ("[" + String(p.current) + "/" + String(p.amount) + "]"), color: Bingovista.colors.Unity_white }
			];
			if (p.pass)
				r.splice(2, 0, { type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 } );
			return r;
		},
		toDesc: function(p) {
			var d;
			if (p.specific) {
				var regi = Bingovista.regionOfRoom(p.roomName).toUpperCase();
				var r = this.regionToDisplayText(this.board.character, regi);
				if (p.roomName === "gw_c11")
					r += " underground";
				if (p.roomName === "gw_c05")
					r += " surface";
				d = "Throw a grenade at the " + this.getMapLink(p.roomName.toUpperCase(), this.board.character, r) + " Scavenger toll" + (p.pass ? ", then pass it." : ".");
			} else {
				if (p.amount <= 1)
					d = "Throw a grenade at a Scavenger toll";
				else
					d = "Throw grenades at " + String(p.amount) + " Scavenger tolls";
				d += (p.pass ? ", then pass them." : ".");
			}
			return d;
		},
		toComment: function(p) {
			return "A hit is registered within a 500-unit radius of the toll. Bomb and pass can be done in either order within a cycle; or even bombed in a previous cycle, then passed later.<br>" +
					"When the <span class=\"bv-code\">specific</span> flag is set, <span class=\"bv-code\">amount</span> and <span class=\"bv-code\">current</span> are unused; when cleared, <span class=\"bv-code\">Scavenger Toll</span> is unused.<br>" +
					"The <span class=\"bv-code\">bombed</span> list records the state of the multi-toll version. It's a dictionary of the form: <span class=\"bv-code\">{room name}|{false/true}[%...]</span>, where the braces are replaced with the respective values, and <span class=\"bv-code\">|</span> and <span class=\"bv-code\">%</span> are literal, and (\"...\") indicates subsequent key-value pairs; or <span class=\"bv-code\">empty</span> when empty. (Room names are case-sensitive, matching the game-internal naming.)  A room is added to the list when bombed, with a Boolean value of <span class=\"bv-code\">false</span> before passing, or <span class=\"bv-code\">true</span> after. By preloading this list, a customized \"all but these tolls\" challenge could be crafted (but, do note the list does not show in-game!).";
		},
		toBinary: function(p) {
			if (!p.specific) {
				//	new format
				var b = Array(5); b.fill(0);
				b[0] = this.challengeValue("BingoBombTollExChallenge");
				Bingovista.applyBool(b, 1, 4, p.pass);
				Bingovista.applyBool(b, 1, 5, p.specific);
				b[3] = this.enumToValue(p.roomName, "tolls");
				b[4] = p.amount;
				for (var k = 0; k < p.bombed.length; k++)
					b.push(this.enumToValue(p.bombed[k], "tolls_bombed"));
				b.push(0);	//	zero terminator
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
			var b = Array(4); b.fill(0);
			//	can use old version
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.pass);
			b[3] = this.enumToValue(p.roomName, "tolls");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoCollectPearlChallenge",
		category: "Collecting pearls",
		super: undefined,
		//	desc of format ["System.Boolean|true|Specific Pearl|0|NULL", "System.String|LF_bottom|Pearl|1|pearls", "0", "System.Int32|1|Amount|3|NULL", "0", "0", ""]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "specific", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Specific Pearl", position: "0",
					formatter: "NULL", defaultval: true
				}
			},
			{
				param: "pearl", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "pearls", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Pearl", position: "1",
					formatter: "pearls", defaultval: "LF_bottom"
				}
			},
			{
				param: "current", type: "number", formatter: "",
				parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
			},
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 1, binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "3",
					formatter: "NULL", minval: 0, maxval: INT_MAX, defaultval: 1
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
				param: "collected", type: "list",
				formatter: "pearls", parse: "list", separator: "cLtD", minval: 0, maxval: 251, defaultval: []
			}
		],
		toPaint: function(p) {
			if (p.specific) {
				return [
					{ type: "text", value: p.pearl.substring(p.pearl.lastIndexOf("_") + 1), color: Bingovista.colors.Unity_white },
					{ type: "break" },
					{ type: "icon", value: "Symbol_Pearl", scale: 1, color: this.maps.pearls.find(o => o.name === p.pearl).color, rotation: 0, background: { type: "icon", value: "radialgradient", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } }
				];
			} else {
				return [
					{ type: "icon", value: "pearlhoard_color", scale: 1, color: this.entityIconColor("Pearl"), rotation: 0 },
					{ type: "break" },
					{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
				];
			}
		},
		toDesc: function(p) {
			if (p.specific) {
				var r = "";
				if (p.pearl === "MS") {
					r = "Old " + this.regionToDisplayText(this.board.character, "GW");
				} else {
					var regi = this.maps.pearls.find(o => o.name === p.pearl).region;
					if (regi === undefined) {
						r = "UNKNOWN";
					} else if (p.pearl === "DM") {
						//	Special case: DM pearl is found in DM only for Spearmaster; it's MS any other time
						if (this.enums.characters.findIndex(s => s === this.board.character) < 0
								|| this.board.character === "Nightcat" || this.board.character === "Any")
							r = this.regionToDisplayText(this.board.character, "DM") + " / " + this.regionToDisplayText(this.board.character, "MS");
						else if (this.board.character === "Spearmaster")
							r = this.regionToDisplayText(this.board.character, "DM");
						else
							r = this.regionToDisplayText(this.board.character, "MS");
					} else {
						r = this.regionToDisplayText(this.board.character, regi);
					}
				}
				return "Collect the " + this.maps.pearls.find(o => o.name === p.pearl).text + " pearl from " + r + ".";
			} else {
				return "Collect " + this.entityNameQuantify(p.amount, "colored pearls") + ".";
			}
		},
		toComment: function(p) {
			return "When collecting multiple pearls, this challenge acts like a flexible The Scholar passage. When collecting single pearls, the amount is unused; when collecting multiple, the location is unused.";
		},
		toBinary: function(p) {
			var b = Array(6); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.specific);
			b[3] = this.enumToValue(p.pearl, "pearls");
			Bingovista.applyShort(b, 4, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoCraftChallenge",
		category: "Crafting items",
		super: undefined,
		//	desc of format ["System.String|JellyFish|Item to Craft|0|craft", "System.Int32|5|Amount|1|NULL", "0", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "craftee", type: "string",
				binType: "number", binOffs: 0,  binSize: 1,
				formatter: "craft", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Item to Craft", position: "0",
					formatter: "craft", defaultval: "SU"
				}
			},
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 1,  binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "1",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
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
				{ type: "icon", value: "crafticon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.entityIconAtlas(p.craftee), scale: 1, color: this.entityIconColor(p.craftee), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Craft " + this.entityNameQuantify(p.amount, this.entityDisplayText(p.craftee)) + ".";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(6); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.craftee, "craft");
			Bingovista.applyShort(b, 4, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoCreatureGateChallenge",
		category: "Transporting the same creature through gates",
		super: undefined,
		//	desc of format ["System.String|CicadaA|Creature Type|1|transport", "0", "System.Int32|4|Amount|0|NULL", "empty", "0", "0"]
		textUpgrade: {},
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
				param: "current", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0 },
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 1, binSize: 1,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "0",
					formatter: "NULL", minval: 1, maxval: CHAR_MAX, defaultval: 1
				}
			},
			{
				param: "creatureGates", type: "list",
				formatter: "", parse: "list", separator: "%", defaultval: ["empty"]
			},
			{
				param: "completed", type: "bool", formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "revealed",  type: "bool", formatter: "", parse: "intBool", defaultval: false
			}
		],
		toPaint: function(p) {
			return [
				{ type: "icon", value: this.entityIconAtlas(p.crit), scale: 1, color: this.entityIconColor(p.crit), rotation: 0 },
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
				{ type: "icon", value: "ShortcutGate", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Transport the same " + this.entityNameQuantify(1, this.entityDisplayText(p.crit)) + " through " + String(p.amount) + " gate" + ((p.amount > 1) ? "s." : ".");
		},
		toComment: function(p) {
			return "When a creature is taken through a gate, that creature is added to a list and the gate is logged. If a gate already appears in the creature's list, taking that gate again will not advance the count. Thus, you can't grind progress by taking one gate back and forth. The list is stored per creature transported; thus, taking a new different creature does not advance the count, nor does piling multiple creatures into one gate. When the total gate count of any logged creature reaches the goal, credit is awarded.";
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
		//	v1.326 merged to BingoScoreChallenge
		//	Used only for binary input; formatted as a BingoScoreExChallenge
		name: "BingoCycleScoreChallenge",
		category: undefined,
		super: "BingoScoreChallenge",
		//	desc of format (< v1.326 BingoCycleScoreChallenge) ["System.Int32|126|Target Score|0|NULL", "0", "0"]
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "target", binType: "number", binOffs: 0, binSize: 2
			}
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	{
		name: "BingoDamageChallenge",
		category: "Hitting creatures with items",
		super: undefined,
		//	desc of format (< v1.091) ["System.String|JellyFish|Weapon|0|weapons", "System.String|WhiteLizard|Creature Type|1|creatures", "0", "System.Int32|6|Amount|2|NULL", "0", "0"]
		//	or (>= v1.091) ["System.String|JellyFish|Weapon|0|weapons", "System.String|AquaCenti|Creature Type|1|creatures", "0", "System.Int32|5|Amount|2|NULL", "System.Boolean|false|In One Cycle|0|NULL", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|5|subregions", "0", "0"]
		//	or (>= v1.2) ["System.String|JellyFish|Weapon|0|weapons", "System.String|PinkLizard|Creature Type|1|creatures", "0", "System.Int32|3|Amount|2|NULL", "System.Boolean|false|In One Cycle|3|NULL", "System.String|Any Region|Region|4|regions", "0", "0"]
		textUpgrade: {
			6: [	//	v1.091 hack: allow 6 or 9 parameters; assume the existing parameters are ordered as expected
				{ op: "splice", offs: 4, rem: 0, data: ["System.Boolean|false|In One Cycle|3|NULL", "System.String|Any Region|Region|4|regions", "System.String|Any Subregion|Subregion|5|subregions"] }
			],
			8: [	//	>= v1.326: Subregion removed; add back in dummy value for compatibility
				{ op: "splice", offs: 6, rem: 0, data: ["System.String|Any Subregion|Subregion|5|subregions"] }
			],
			9: [	//	Bingovista-native format; one typo cleanup, then return the .length = 9
				{ op: "replace", offs: 6, find: "Journey\\'s End", replace: "Journey's End" }
			]
		},
		textDowngrade: {
			9: [	//	Return to Bingo-native format
				{ op: "splice", offs: 6, rem: 1, data: [] }
			]
		},
		template: [
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
		],
		toPaint: function(p) {
			var paint = [];
			if (p.weapon !== "Any Weapon")
				paint.push( { type: "icon", value: this.entityIconAtlas(p.weapon), scale: 1, color: this.entityIconColor(p.weapon), rotation: 0 } );
			paint.push( { type: "icon", value: "bingoimpact", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			if (p.victim !== "Any Creature")
				paint.push( { type: "icon", value: this.entityIconAtlas(p.victim), scale: 1, color: this.entityIconColor(p.victim), rotation: 0 } );
			if (p.subregion === "Any Subregion") {
				if (p.region !== "Any Region")
					paint.push(
						{ type: "break" },
						{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
					);
			} else {
				paint.push(
					{ type: "break" },
					{ type: "text", value: p.subregion, color: Bingovista.colors.Unity_white }
				);
			}
			paint.push(
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			);
			if (p.inOneCycle)
				paint.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			return paint;
		},
		toDesc: function(p) {
			var r = this.regionToDisplayText(this.board.character, p.region /*, p.subregion */);
			if (r > "") r = ", in " + r;
			var d = "Hit " + this.entityDisplayText(p.victim) + " with " + this.entityDisplayText(p.weapon);
			d += " " + String(p.amount) + ((p.amount > 1) ? " times" : " time") + r;
			if (p.inOneCycle) d += ", in one cycle";
			return d + ".";
		},
		toComment: function(p) {
			return "Note: the reskinned BLLs in the Past Garbage Wastes tunnel <em>do not count</em> as DLLs for this challenge.<br>" +
					"Note: <span class=\"bv-code\">Subregion</span> was never fully implemented, and is deprecated in v1.2+. Bingovista displays this parameter only for completeness.";
		},
		toBinary: function(p) {
			//	start with classic format...
			var b = Array(7); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.weapon, "weapons");
			b[4] = this.enumToValue(p.victim, "creatures");
			Bingovista.applyShort(b, 5, p.amount);
			if (p.inOneCycle || p.region !== "Any Region" || p.subregion !== "Any Subregion") {
				//	...have to use expanded form
				b[0] = this.challengeValue("BingoDamageExChallenge");
				Bingovista.applyBool(b, 1, 4, p.inOneCycle);
				b.push(this.enumToValue(p.region, "regions"));
				b.push(this.enumToValue(p.subregion, "subregions"));
			}
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoDepthsChallenge",
		category: "Dropping a creature in the depth pit",
		super: undefined,
		//	desc of format ["System.String|VultureGrub|Creature Type|0|depths", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "crit", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "depths", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Creature Type", position: "0",
					formatter: "depths", altthreshold: 64, altformatter: "creatures", defaultval: "SmallCentipede"
				}
			},
			{
				param: "completed", type: "bool", formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "revealed",  type: "bool", formatter: "", parse: "intBool", defaultval: false
			}
		],
		toPaint: function(p) {
			return [
				{ type: "icon", value: this.entityIconAtlas(p.crit), scale: 1, color: this.entityIconColor(p.crit), rotation: 0 },
				{ type: "icon", value: "deathpiticon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "SB_D06", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Drop " + this.entityNameQuantify(1, this.entityDisplayText(p.crit)) + " into the Depths drop room (" + this.getMapLink("SB_D06", this.board.character) + ").";
		},
		toComment: function(p) {
			return "Player, and creature of target type, must be in the room at the same time, and the creature's position must be below the drop.";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			if (this.enums.transport.includes(p.crit))
				b[3] = this.enumToValue(p.crit, "depths");
			else
				b[3] = this.enumToValue(p.crit, "creatures") + 64 - 1;	//	crit template altthreshold
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoDodgeLeviathanChallenge",
		category: "Dodge a Leviathan's bite",
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
				{ type: "icon", value: "leviathan_dodge", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
			];
		},
		toDesc: function(p) {
			return "Dodge a Leviathan's bite.";
		},
		toComment: function(p) {
			return "Being in close proximity to a Leviathan, as it's winding up a bite, will activate this goal. (A more direct/literal interpretation&mdash;having to have been physically inside its maw, then surviving after it slams shut&mdash;was found... too challenging by playtesters.)";
		},
		toBinary: function(p) {
			var b = Array(3); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoDontUseItemChallenge",
		category: "Avoiding items",
		super: undefined,
		//	desc of format ["System.String|BubbleGrass|Item type|0|banitem", "0", "0", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "item", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "banitem", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Item type", position: "0",
					formatter: "banitem", defaultval: "BubbleGrass"
				}
			},
			{
				param: "isFood", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "completed", type: "bool",
				formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "revealed", type: "bool",
				formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "isCreature", type: "bool",
				binType: "bool", binOffs: 0, bit: 5,
				formatter: "", parse: "intBool", defaultval: false
			}
		],
		toPaint: function(p) {
			return [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
				{ type: "icon", value: this.entityIconAtlas(p.item), scale: 1, color: this.entityIconColor(p.item), rotation: 0 }
			];
		},
		toDesc: function(p) {
			return "Never " + (p.isFood ? "eat" : "use") + " " + this.entityDisplayText(p.item) + ".";
		},
		toComment: function(p) {
			return "\"Using\" an item involves activating or throwing an (offensive or defensive) item, eating a food item, or holding any other type of item for 5 seconds. (When sheltering with an unfilled food meter, food items in the shelter are consumed automatically up to the required minimum; this behavior <em>does not</em> count against this goal!)";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.isFood);
			Bingovista.applyBool(b, 1, 5, p.isCreature);
			b[3] = this.enumToValue(p.item, "banitem");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoEatChallenge",
		category: "Eating specific food",
		super: undefined,
		//	desc of format (< v1.2) ["System.Int32|6|Amount|1|NULL", "0", "0", "System.String|DangleFruit|Food type|0|food", "0", "0"]
		//	or (>= v1.2) ["System.Int32|4|Amount|3|NULL", "0", "0", "System.String|SlimeMold|Food type|0|food", "System.Boolean|false|While Starving|2|NULL", "0", "0"]
		textUpgrade: {
			6: [	//	< v1.2
				{ op: "splice", offs: 4, rem: 0, data: ["System.Boolean|false|While Starving|2|NULL"] }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "amountRequired", type: "number",
				binType: "number", binOffs: 0, binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "1",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "currentEated", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
			},
			{
				param: "isCreature", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "foodType", type: "string",
				binType: "number", binOffs: 2, binSize: 1,
				formatter: "food", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Food type", position: "0",
					formatter: "food", defaultval: "SlimeMold"
				}
			},
			{
				param: "starve", type: "bool",
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "While Starving", position: "2",
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
				{ type: "icon", value: "foodSymbol", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.entityIconAtlas(p.foodType), scale: 1, color: this.entityIconColor(p.foodType), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.currentEated) + "/" + String(p.amountRequired) + "]", color: Bingovista.colors.Unity_white }
			];
			if (p.starve)
				paint.push( { type: "icon", value: "MartyrB", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			return paint;
		},
		toDesc: function(p) {
			return "Eat " + this.entityNameQuantify(p.amountRequired, this.entityDisplayText(p.foodType)) + (p.starve ? ", while starving." : ".");
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(6); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.amountRequired);
			Bingovista.applyBool(b, 1, 4, p.isCreature);
			Bingovista.applyBool(b, 1, 5, p.starve);
			b[5] = this.enumToValue(p.foodType, "food");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoEchoChallenge",
		category: "Visiting echoes",
		super: undefined,
		//	desc of format (< v1.2) ["System.String|SB|Region|0|echoes", "System.Boolean|false|While Starving|1|NULL", "0", "0"]
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
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Specific Echo", position: "0",
					formatter: "NULL", defaultval: true
				}
			},
			{
				param: "ghost", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "echoes", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "1",
					formatter: "echoes", defaultval: "LF"
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
				formatter: "echoes", parse: "list", separator: "|", defaultval: []
			}
		],
		toPaint: function(p) {
			var paint = [
				{ type: "icon", value: "echo_icon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "text", value: (p.specific ? p.ghost : "[" + String(p.current) + "/" + String(p.amount) + "]"), color: Bingovista.colors.Unity_white }
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
			return "Visit " + (p.specific ? ("the " + this.regionToDisplayText(this.board.character, p.ghost) + " Echo") : (p.amount <= 1 ? "an Echo" : String(p.amount) + " Echoes")) + (p.starve ? ", while starving." : ".");
		},
		toComment: function(p) {
			return "The \"visited\" list records the state of the multi-echo version. It is a <span class=\"bv-code\">|</span>-separated list of region codes. A region is added to the list when its echo has been visited. By preloading this list, a customized \"all but these echoes\" challenge could be crafted (but, do note the list does not show in-game!).";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.starve);
			b[3] = this.enumToValue(p.ghost, "echoes");
			b[2] = b.length - GOAL_LENGTH;
			if (!p.specific) {
				b[0] = this.challengeValue("BingoEchoExChallenge");
				b.push(p.amount);
				for (var k = 0; k < p.visited.length; k++)
					b.push(this.enumToValue(p.visited[k], "regions"));
				b.push(0);	//	zero terminator
			}
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoEnterRegionChallenge",
		category: "Entering a region",
		super: undefined,
		//	desc of format ["System.String|CC|Region|0|regionsreal", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "region", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "regionsreal", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "0",
					formatter: "regionsreal", defaultval: "CC"
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
		name: "BingoScoreChallenge",	//	Was BingoGlobalScoreChallenge
		category: "Scoring global points",
		super: undefined,
		//	desc of format (< v1.326 BingoCycleScoreChallenge) ["System.Int32|126|Target Score|0|NULL", "0", "0"]
		//	desc of format (< v1.326 BingoGlobalScoreChallenge) ["0", "System.Int32|271|Target Score|0|NULL", "0", "0"]
		//	desc of format (>= v1.326) ["0", "System.Int32|141|Target Score|0|NULL", "System.Boolean|false|In one Cycle|1|NULL", "0", "0"]
		textUpgrade: {
			3: [	//	Cycle
				{ op: "unshift", data: ["0"] },
				{ op: "splice", offs: 2, rem: 0, data: ["System.Boolean|true|In one Cycle|1|NULL"] }
			],
			4: [	//	Global
				{ op: "splice", offs: 2, rem: 0, data: ["System.Boolean|false|In one Cycle|1|NULL"] }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
			},
			{
				param: "target",  type: "number",
				binType: "number", binOffs: 0, binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Target Score", position: "0",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "oneCycle", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "In one Cycle", position: "1",
					formatter: "NULL", defaultval: true
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
				{ type: "icon", value: "Multiplayer_Star", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.target) + "]", color: Bingovista.colors.Unity_white }
			];
			if (p.oneCycle)
				paint.splice(1, 0, { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			return paint;
		},
		toDesc: function(p) {
			return "Earn " + String(p.target) + " points from creature kills" + (p.oneCycle ? " in one cycle." : ".");
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.target);
			b[2] = b.length - GOAL_LENGTH;
			if (p.oneCycle)
				b[0] = this.challengeValue("BingoCycleScoreChallenge");
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoGreenNeuronChallenge",
		category: "Delivering the Green Neuron",
		super: undefined,
		//	desc of format ["System.Boolean|true|Looks to the Moon|0|NULL", "0", "0"]
		//	could future-proof this as iterator name (ala NeuronDelivery textUp/Downgrade)
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "moon", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Looks to the Moon", position: "0",
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
			var iter = this.maps.iterators.find(o => o.name === (p.moon ? "moon" : "pebbles"));
			return [
				{ type: "icon", value: "GuidanceNeuron", scale: 1, color: Bingovista.colors.GuidanceNeuron, rotation: 0 },
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
				{ type: "icon", value: iter.icon, scale: 1, color: iter.color, rotation: 0 }
			];
		},
		toDesc: function(p) {
			return (p.moon ?
					("Reactivate ") + this.maps.iterators.find(o => o.name === "moon").text + "." :
					("Deliver the green neuron to " + this.maps.iterators.find(o => o.name === "pebbles").text + ".")
					);
		},
		toComment: function(p) {
			return "The green neuron only has to enter the screen the iterator is on and start the cutscene; waiting for full dialog/startup is not required for credit.";
		},
		toBinary: function(p) {
			var b = Array(3); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.moon);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoHatchNoodleChallenge",
		category: "Hatching Noodlefly eggs",
		super: undefined,
		//	desc of format (< v1.321) ["0", "System.Int32|3|Amount|1|NULL", "System.Boolean|true|At Once|0|NULL", "0", "0"]
		//	desc of format (>= v1.321) ["System.String|Any Region|Region|1|nootregions", "System.Boolean|false|Different Regions|2|NULL", "System.Boolean|false|At once|3|NULL", "0", "System.Int32|2|Amount|0|NULL", "", "0", "0"]
		textUpgrade: {
			5: [
				{ op: "move", from: 2, to: 0 },
				{ op: "unshift", data: ["System.String|Any Region|Region|1|nootregions", "System.Boolean|false|Different Regions|2|NULL"] },
				{ op: "splice", offs: 5, rem: 0, data: [""] }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "region", type: "string",
				formatter: "nootregions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "1",
					formatter: "nootregions", defaultval: "Any Region"
				}
			},
			{
				param: "differentRegions", type: "bool",
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Different Regions", position: "2",
					formatter: "NULL", defaultval: false
				}
			},
			{
				param: "oneCycle", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "At Once", position: "3",
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
				param: "hatchRegions", type: "list",
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
				{ type: "icon", value: this.entityIconAtlas("NeedleEgg"), scale: 1, color: this.entityIconColor("NeedleEgg"), rotation: 0 },
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
				{ type: "icon", value: this.entityIconAtlas("SmallNeedleWorm"), scale: 1, color: this.entityIconColor("SmallNeedleWorm"), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
			if (p.differentRegions) {
				paint.splice(3, 0,
					{ type: "break" },
					{ type: "icon", value: "TravellerA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
				);
			} else if (p.region !== "Any Region") {
				paint.splice(3, 0,
					{ type: "break" },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
				);
			} else if (p.oneCycle) {
				paint.splice(3, 0,
					{ type: "break" },
					{ type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
				);
			}
			return paint;
		},
		toDesc: function(p) {
			var r = ", in different regions";
			if (!p.differentRegions) {
				r = this.regionToDisplayText(this.board.character, p.region);
				if (r > "") r = ", in " + r;
			}
			return "Hatch " + this.entityNameQuantify(p.amount, this.entityDisplayText("NeedleEgg")) + r + (p.oneCycle ? ", in one cycle." : ".");
		},
		toComment: function(p) {
			//	test to confirm this is still true
			return "Eggs must be hatched where the player is sheltering. Eggs stored in other shelters disappear and do not give credit towards this goal.";
		},
		toBinary: function(p) {
			if (p.region !== "Any Region" || p.differentRegions) {
				var b = Array(5); b.fill(0);
				b[0] = this.challengeValue("BingoHatchNoodleExChallenge");
				b[3] = p.amount;
				Bingovista.applyBool(b, 1, 4, p.oneCycle);
				Bingovista.applyBool(b, 1, 5, p.differentRegions);
				b[4] = this.enumToValue(p.region, "regionsreal");
				for (var k = 0; k < p.hatchRegions.length; k++)
					b.push(this.enumToValue(p.hatchRegions[k], "regionsreal"));
				b.push(0);	//	zero terminator
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = p.amount;
			Bingovista.applyBool(b, 1, 4, p.oneCycle);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoHellChallenge",
		category: "Avoiding death before completing challenges",
		super: undefined,
		//	desc of format ["0", "System.Int32|2|Amount|0|NULL", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
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
			return [
				{ type: "icon", value: "completechallenge", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white },
				{ type: "break" },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
				{ type: "icon", value: "MartyrB", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
			];
		},
		toDesc: function(p) {
			return "Do not die before completing " + this.entityNameQuantify(p.amount, "bingo challenges") + ".";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = p.amount;
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoItemHoardChallenge",
		category: "Hoarding items in shelters",
		super: undefined,
		//	desc of format (< v1.092) ["System.Int32|5|Amount|1|NULL", "System.String|PuffBall|Item|0|expobject", "0", "0"]
		//	or (>= 1.092) ["System.Boolean|true|Any Shelter|2|NULL", "0", "System.Int32|4|Amount|0|NULL", "System.String|DangleFruit|Item|1|expobject", "0", "0", ""]
		//	or (>= 1.2) ["System.Boolean|true|Any Shelter|2|NULL", "0", "System.Int32|4|Amount|0|NULL", "System.String|Mushroom|Item|1|expobject", "System.String|VS|Region|4|regions", "0", "0", ""]
		textUpgrade: {
			4: [	//	1.092 hack: allow 4 or 7 parameters; assume the existing parameters are ordered as expected
				{ op: "unshift", data: ["System.Boolean|false|Any Shelter|2|NULL", "0"] },
				{ op: "push", data: [""] }
			],
			7: [	//	1.2 hack: allow 4, 7 or 8 parameters
				{ op: "splice", offs: 4, rem: 0, data: ["System.String|Any Region|Region|4|regions"] }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "anyShelter", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Any Shelter", position: "2",
					formatter: "NULL", defaultval: false
				}
			},
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
			},
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "0",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "target", type: "string",
				binType: "number", binOffs: 1, binSize: 1,
				formatter: "expobject", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Item", position: "1",
					formatter: "expobject", defaultval: "DangleFruit"
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
				param: "completed", type: "bool",
				formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "revealed",  type: "bool",
				formatter: "", parse: "intBool", defaultval: false
			},
			{
				param: "collected", type: "list",
				formatter: "", parse: "list", separator: "cLtD", minval: 0, maxval: 251, defaultval: []
			}
		],
		toPaint: function(p) {
			var paint = [
				{ type: "icon", value: this.entityIconAtlas(p.target), scale: 1, color: this.entityIconColor(p.target), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
			if (p.anyShelter) {
				paint.splice(1, 0,
					{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
					{ type: "icon", value: "doubleshelter", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
				);
			} else {
				paint.unshift( { type: "icon", value: "ShelterMarker", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			}
			if (p.region !== "Any Region")
				paint.splice(paint.length - 2, 0,
					{ type: "break" },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
				);
			return paint;
		},
		toDesc: function(p) {
			var r = this.regionToDisplayText(this.board.character, p.region) + ".";
			if (r.length > 1) r = ", in " + r;
			var d = "";
			d += (p.anyShelter) ? "Bring " : "Hoard ";
			d += this.entityNameQuantify(p.amount, this.entityDisplayText(p.target));
			d += (p.anyShelter) ? " to " : " in ";
			if (p.amount == 1)
				d += "a shelter";
			else if (p.anyShelter)
				d += "any shelters";
			else
				d += "the same shelter";
			return d + r;
		},
		toComment: function(p) {
			return "The 'same shelter' option behaves as the base Expedition goal; count is updated on shelter close.<br>" +
					"The 'any shelter' option counts the total across any shelters in the world. Counts are per item ID, updated when the target item is brought into a shelter. Counts never go down, so items are free to use after \"hoarding\" them, including eating or removing. Because items are tracked by ID, this goal cannot be cheesed by taking the same items between multiple shelters; multiple unique items must be hoarded. In short, it's the act of hoarding (taking a new item into a shelter) that counts up.";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.anyShelter);
			b[3] = p.amount;
			b[4] = this.enumToValue(p.target, "expobject");
			if (p.region !== "Any Region") {
				b[0] = this.challengeValue("BingoItemHoardExChallenge");
				b.push(this.enumToValue(p.region, "regions"));
			}
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoKarmaFlowerChallenge",
		category: "Consuming Karma Flowers",
		super: undefined,
		//	desc of format (< v1.32) ["0", "System.Int32|5|Amount|0|NULL", "0", "0"]
		//	or (>= v1.32) ["System.String|Any Region|Region|1|regions", "System.Boolean|true|Different Regions|2|NULL", "System.Boolean|false|In one Cycle|3|NULL", "0", "System.Int32|4|Amount|0|NULL", "", "0", "0"]
		textUpgrade: {
			4: [	//	v1.32
				{ op: "unshift", data: ["System.String|Any Region|Region|1|regions", "System.Boolean|false|Different Regions|2|NULL", "System.Boolean|false|In one Cycle|3|NULL"] },
				{ op: "splice", offs: 5, rem: 0, data: [""] }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "region", type: "string",
				formatter: "regions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "1",
					formatter: "regions", defaultval: "Any Region"
				}
			},
			{
				param: "differentRegions", type: "bool",
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
				param: "eatRegions", type: "list",
				formatter: "regions", parse: "list", separator: "|", minval: 0, maxval: 251, defaultval: []
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
				{ type: "icon", value: "foodSymbol", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.entityIconAtlas("KarmaFlower"), scale: 1, color: this.entityIconColor("KarmaFlower"), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
			if (p.differentRegions) {
				paint.splice(2, 0, { type: "icon", value: "TravellerA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			} else if (p.region !== "Any Region") {
				paint.splice(2, 0,
					{ type: "break" },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
				);
			}
			if (p.oneCycle)
				paint.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			return paint;
		},
		toDesc: function(p) {
			var d = "Consume " + this.entityNameQuantify(p.amount, this.entityDisplayText("KarmaFlower"));
			if (p.differentRegions && p.amount > 1)
				d += ", in different regions";
			else if (p.region !== "Any Region")
				d += ", in " + this.regionToDisplayText(this.board.character, p.region);
			if (p.oneCycle)
				d += ", in one cycle";
			return d + ".";
		},
		toComment: function(p) {
			return "With this goal present on the board, flowers spawn in the world, in their normal locations. The player obtains the benefit of consuming the flower (protecting karma level). While the goal is in progress, players <em>do not drop</em> the flower on death. After the goal is completed or locked, a flower can drop on death as normal.";
		},
		toBinary: function(p) {
			if (p.region !== "Any Region" || p.differentRegions || p.eatRegions.length) {
				var b = Array(6); b.fill(0);
				b[0] = this.challengeValue("BingoKarmaFlowerExChallenge");
				Bingovista.applyBool(b, 1, 4, p.oneCycle);
				Bingovista.applyBool(b, 1, 5, p.differentRegions);
				Bingovista.applyShort(b, 3, p.amount);
				b[5] = this.enumToValue(p.region, "regions");
				for (var k = 0; k < p.eatRegions.length; k++)
					b.push(this.enumToValue(p.eatRegions[k], "regions"));
				b.push(0);	//	zero terminator
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.oneCycle);
			Bingovista.applyShort(b, 3, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoKillChallenge",
		category: "Killing creatures",
		super: undefined,
		//	assert: desc of format (< v1.2) ["System.String|Scavenger|Creature Type|0|creatures", "System.String|Any Weapon|Weapon Used|6|weaponsnojelly", "System.Int32|5|Amount|1|NULL", "0", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions", "System.Boolean|false|In one Cycle|3|NULL", "System.Boolean|false|Via a Death Pit|7|NULL", "System.Boolean|false|While Starving|2|NULL", "0", "0"]
		//	or (>= v1.2) [System.String|TentaclePlant|Creature Type|0|creatures", "System.String|Any Weapon|Weapon Used|6|weaponsnojelly", "System.Int32|4|Amount|1|NULL", "0", "System.String|Any Region|Region|5|regions", "System.Boolean|false|In one Cycle|3|NULL", "System.Boolean|false|Via a Death Pit|7|NULL", "System.Boolean|false|While Starving|2|NULL", "System.Boolean|false|While under mushroom effect|8|NULL", "0", "0"]
		//	BV uses a superset, containing subregion *and* mushroom; length 12
		//	crit, weapon, amount, current, region, subregion, oneCycle, deathPit, starve, shrooms, completed, revealed
		textUpgrade: {
			11: [	//	< v1.2: contains subregion, no mushroom
				{ cond: { type: "search", idx: 8, str: "mushroom", find: false }, op: "splice", offs: 9, rem: 0, data: ["System.Boolean|false|While under mushroom effect|8|NULL"] },
				//	>= v1.2: Subregion removed; add back in dummy value for compatibility
				{ cond: { type: "search", idx: 8, str: "mushroom", find: true }, op: "splice", offs: 5, rem: 0, data: ["System.String|Any Subregion|Subregion|4|subregions"] }
			]
		},
		textDowngrade: {
			12: [	//	v1.326: subregions deprecated
				{ op: "splice", offs: 5, rem: 1, data: [] }
			]
		},
		template: [
			{
				param: "crit", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "creatures", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Creature Type", position: "0",
					formatter: "creatures", defaultval: "Any Creature"
				}
			},
			{
				param: "weapon", type: "string",
				binType: "number", binOffs: 1, binSize: 1,
				formatter: "weapons", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Weapon Used", position: "6",
					formatter: "weaponsnojelly", defaultval: "Any Weapon"
				}
			},
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 2, binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "1",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
			},
			{
				param: "region", type: "string",
				binType: "number", binOffs: 4, binSize: 1,
				formatter: "regions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "5",
					formatter: "regions", defaultval: "Any Region"
				}
			},
			{
				param: "subregion", type: "string",
				binType: "number", binOffs: 5, binSize: 1,
				formatter: "subregions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Subregion", position: "4",
					formatter: "subregions", defaultval: "Any Subregion"
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
				param: "deathPit", type: "bool",
				binType: "bool", binOffs: 0, bit: 5,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Via a Death Pit", position: "7",
					formatter: "NULL", defaultval: false
				}
			},
			{
				param: "starve", type: "bool",
				binType: "bool", binOffs: 0, bit: 6,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "While Starving", position: "2",
					formatter: "NULL", defaultval: false
				}
			},
			{
				param: "shrooms", type: "bool",
				binType: "bool", binOffs: 0, bit: 7,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "While under mushroom effect", position: "8",
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
			var paint = [];
			if (p.deathPit)
				paint.push( { type: "icon", value: "deathpiticon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			else if (p.weapon !== "Any Weapon")
				paint.push( { type: "icon", value: this.entityIconAtlas(p.weapon), scale: 1, color: this.entityIconColor(p.weapon), rotation: 0 } );
			paint.push( { type: "icon", value: "Multiplayer_Bones", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			if (p.crit !== "Any Creature") {
				paint.push( { type: "icon", value: this.entityIconAtlas(p.crit), scale: 1, color: this.entityIconColor(p.crit), rotation: 0 } );
			}
			paint.push( { type: "break" } );
			if (/* p.subregion !== "Any Subregion" && */ p.region !== "Any Region") {
				paint.push(
					{ type: "text", value: /* (p.subregion === "Any Subregion" ? p.region : p.subregion) */ p.region, color: Bingovista.colors.Unity_white },
					{ type: "break" }
				);
			}
			paint.push( { type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white } );
			if (p.starve)
				paint.push( { type: "icon", value: "MartyrB", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			if (p.oneCycle)
				paint.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			if (p.shrooms)
				paint.push( { type: "icon", value: this.entityIconAtlas("Mushroom"), scale: 1, color: this.entityIconColor("Mushroom"), rotation: 0 } );
			return paint;
		},
		toDesc: function(p) {
			var c = this.entityNameQuantify(p.amount, ((p.crit !== "Any Creature") ? this.entityDisplayText(p.crit) : "creatures"));
			var r = this.regionToDisplayText(this.board.character, p.region /*, p.subregion */);
			if (r > "") r = " in " + r;
			var w = ", with a death pit";
			if (!p.deathPit) {
				if (p.weapon !== "Any Weapon") {
					w = " with " + this.entityDisplayText(p.weapon);
				} else {
					w = "";
				}
			}
			return "Kill " + c + r + w
					+ (p.starve ? ", while starving" : "")
					+ (p.oneCycle ? ", in one cycle" : "")
					+ (p.shrooms ? ", while under mushroom effect." : ".");
		},
		toComment: function(p) {
			return "Credit is determined by the last source of 'blame' at time of death. For creatures that take multiple hits, try to \"soften them up\" with more common items, before using limited ammunition to deliver the killing blow.  Creatures that \"bleed out\", can be mortally wounded (brought to or below 0 HP), before being tagged with a specific weapon to obtain credit. Conversely, weapons that do slow damage (like Spore Puff) can lose blame over time; consider carrying additional ammunition to deliver the killing blow. Starving: must be in the \"malnourished\" state; this state is cleared after eating to full.<br>" +
					"Note: the reskinned BLLs in the Past Garbage Wastes tunnel, count as both BLL and DLL for this challenge.<br>" +
					"(&lt; v1.2: If defined, <span class=\"bv-code\">Subregion</span> takes precedence over <span class=\"bv-code\">Region</span>. If set, <span class=\"bv-code\">Via a Death Pit</span> takes precedence over <span class=\"bv-code\">Weapon Used</span>.)<br>" +
					"Note: <span class=\"bv-code\">Subregion</span> was never fully implemented, and is deprecated in v1.2+. Bingovista displays this parameter only for completeness.";
		},
		toBinary: function(p) {
			var b = Array(9); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.oneCycle);
			Bingovista.applyBool(b, 1, 5, p.deathPit);
			Bingovista.applyBool(b, 1, 6, p.starve);
			Bingovista.applyBool(b, 1, 7, p.shrooms);
			b[3] = this.enumToValue(p.crit, "creatures");
			b[4] = this.enumToValue(p.weapon, "weaponsnojelly");
			Bingovista.applyShort(b, 5, p.amount);
			b[7] = this.enumToValue(p.region, "regions");
			b[8] = this.enumToValue(p.subregion, "subregions");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoMaulTypesChallenge",
		category: "Mauling different types of creatures",
		super: undefined,
		//	desc of format "0", "System.Int32|4|Amount|0|NULL", "0", "0", ""
		textUpgrade: {},
		textDowngrade: {},
		template: [
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
			},
			{
				param: "doneTypes", type: "list",
				formatter: "creatures", parse: "list", separator: "|", minval: 0, maxval: 253, defaultval: []
			}
		],
		toPaint: function(p) {
			return [
				{ type: "icon", value: "artimaulcrit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Maul " + (p.amount > 1 ? String(p.amount) + " unique creature types." : "a creature.");
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = p.amount;
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoMaulXChallenge",
		category: "Mauling creatures a certain amount of times",
		super: undefined,
		//	desc of format ["0", "System.Int32|13|Amount|0|NULL", "0", "0"]
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
				{ type: "icon", value: "artimaul", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return p.amount > 1 ? "Maul creatures " + String(p.amount) + " times." : "Maul a creature.";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoNeuronDeliveryChallenge",
		category: "Delivering neurons",
		super: undefined,
		//	desc of format ["System.Int32|2|Amount of Neurons|0|NULL", "0", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "neurons", type: "number",
				binType: "number", binOffs: 0, binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount of Neurons", position: "0",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "delivered", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
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
			var oracle = "moon";
			return [
				{ type: "icon", value: "Symbol_Neuron", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
				{ type: "icon", value: this.maps.iterators.find(o => o.name === oracle).icon, scale: 1, color: this.maps.iterators.find(o => o.name === oracle).color, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.delivered) + "/" + String(p.neurons) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			var oracle = "moon";
			return "Deliver " + this.entityNameQuantify(p.neurons, this.entityDisplayText("SSOracleSwarmer")) + " to " + this.maps.iterators.find(o => o.name === oracle).text + ".";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.neurons);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoNoNeedleTradingCheallenge",
		category: "Avoiding giving Needles to Scavengers",
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
				{ type: "icon", value: "spearneedle", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "commerce", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Kill_Scavenger", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 }
			];
		},
		toDesc: function(p) {
			return "Do not gift Needles to Scavengers.";
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
		name: "BingoNoRegionChallenge",
		category: "Avoiding a region",
		super: undefined,
		//	desc of format ["System.String|SI|Region|0|regionsreal", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "region", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "regionsreal", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "0",
					formatter: "regionsreal", defaultval: "SU"
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
		name: "BingoPearlDeliveryChallenge",
		category: "Delivering colored pearls",
		super: undefined,
		//	desc of format ["System.String|LF|Pearl from Region|0|regions", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "region", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "regions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Pearl from Region", position: "0",
					formatter: "regions", defaultval: "SU"
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
			var oracle = ((this.board.character === "Artificer") ? "pebbles" : "moon");
			return [
				{ type: "text", value: p.region, color: Bingovista.colors.Unity_white },
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: this.entityIconColor("Pearl"), rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 180 },
				{ type: "break" },
				{ type: "icon", value: this.maps.iterators.find(o => o.name === oracle).icon, scale: 1, color: this.maps.iterators.find(o => o.name === oracle).color, rotation: 0 }
			];
		},
		toDesc: function(p) {
			var oracle = ((this.board.character === "Artificer") ? "pebbles" : "moon");
			return "Deliver the " + this.regionToDisplayText(this.board.character, p.region) + " colored pearl to " + this.maps.iterators.find(o => o.name === oracle).text + ".";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.region, "regions");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoPearlHoardChallenge",
		category: "Putting pearls in shelters",
		super: undefined,
		//	desc of format (< v1.2) ["System.Boolean|false|Common Pearls|0|NULL", "System.Int32|2|Amount|1|NULL", "System.String|SL|In Region|2|regions", "0", "0"]
		//	or (>= v1.2) ["System.Boolean|true|Common Pearls|0|NULL", "System.Boolean|false|Any Shelter|2|NULL", "0", "System.Int32|2|Amount|1|NULL", "System.String|LF|Region|3|regions", "0", "0", ""]
		//	params: common, anyShelter, current, amount, region, completed, revealed, collected
		textUpgrade: {
			5: [
				{ op: "splice", offs: 1, rem: 0, data: ["System.Boolean|false|Any Shelter|2|NULL", "0"] },
				{ op: "push", data: [""] }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "common", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Common Pearls", position: "0",
					formatter: "NULL", defaultval: false
				}
			},
			{
				param: "anyShelter", type: "bool",
				binType: "bool", binOffs: 0, bit: 5,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Any Shelter", position: "2",
					formatter: "NULL", defaultval: false
				}
			},
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
			},
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 0, binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "1",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "region", type: "string",
				binType: "number", binOffs: 2, binSize: 1,
				formatter: "regions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "3",
					formatter: "regions", defaultval: "SU"
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
				param: "collected", type: "list",
				formatter: "", parse: "list", separator: "cLtD", minval: 0, maxval: 251, defaultval: []
			}
		],
		toPaint: function(p) {
			var paint = [ { type: "icon", value: (p.common ? "pearlhoard_normal" : "pearlhoard_color"), scale: 1, color: this.entityIconColor("Pearl"), rotation: 0 } ];
			if (p.anyShelter) {
				paint.push(
					{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
					{ type: "icon", value: "doubleshelter", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
				);
			} else {
				paint.unshift( { type: "icon", value: "ShelterMarker", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			}
			if (p.region !== "Any Region")
				paint.push(
					{ type: "break" },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
				);
			paint.push(
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			);
			return paint;
		},
		toDesc: function(p) {
			var r = this.regionToDisplayText(this.board.character, p.region);
			if (r > "") r = ", in " + r;
			var d = this.entityNameQuantify(p.amount, p.common ? "common pearls" : "colored pearls");
			if (p.anyShelter)
				d = "Bring " + d + ", to ";
			else
				d = "Hoard " + d + ", in ";
			if (p.amount == 1)
				d += "a shelter";
			else if (p.anyShelter)
				d += "any shelters";
			else d += "the same shelter";
			return d + r + ".";
		},
		toComment: function(p) {
			return "Note: faded pearls in Saint campaign do not count toward a \"common pearls\" goal; they still count as colored.  For example, once touched, they show on the map with their assigned (vibrant) color.  Misc pearls do not count for either type of goal. Pearls from Iterator chambers do count as colored.<br>" +
					"The 'one shelter' option behaves as the base Expedition goal; count is updated on shelter close.<br>" +
					"The 'any shelter' option counts the total across all shelters in the world. Counts are per pearl ID, updated when the pearl is brought into a shelter. Counts never go down, so pearls are free to use after \"hoarding\" them. Because pearls are tracked by ID, this goal cannot be cheesed by taking the same pearls between multiple shelters; multiple unique pearls must be hoarded. In short, it's the act of hoarding (putting a <em>new</em> pearl <em>in</em> a shelter) that counts up.";
		},
		toBinary: function(p) {
			var b = Array(6); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.common);
			Bingovista.applyBool(b, 1, 5, p.anyShelter);
			Bingovista.applyShort(b, 3, p.amount);
			b[5] = this.enumToValue(p.region, "regions");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoPinChallenge",
		category: "Pinning creatures to walls",
		super: undefined,
		//	desc of format ["0", "System.Int32|5|Amount|0|NULL", "System.String|PinkLizard|Creature Type|1|creatures", "", "System.String|SU|Region|2|regions", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
			},
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 0,  binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "0",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "crit", type: "string",
				binType: "number", binOffs: 2,  binSize: 1,
				formatter: "creatures", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Creature Type", position: "1",
					formatter: "creatures", defaultval: "CicadaA"
				}
			},
			{
				param: "pinRegions", type: "list",
				formatter: "regionsreal", parse: "list", separator: "|", minval: 0, maxval: 250, defaultval: []
			},
			{
				param: "region", type: "string",
				binType: "number", binOffs: 3,  binSize: 1,
				formatter: "regions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "2",
					formatter: "regions", defaultval: "SU"
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
			var paint = [ { type: "icon", value: "pin_creature", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } ];
			if (p.crit !== "Any Creature") {
				paint.push( { type: "icon", value: this.entityIconAtlas(p.crit), scale: 1, color: this.entityIconColor(p.crit), rotation: 0 } );
			}
			paint.push(
				{ type: "break" },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			);
			paint.splice(paint.length - 2, 0, 
					(p.region === "Any Region") ?
					{ type: "icon", value: "TravellerA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } :
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white } );
			return paint;
		},
		toDesc: function(p) {
			var r = this.regionToDisplayText(this.board.character, p.region);
			if (r === "") r = "different regions";
			return "Pin " + this.entityNameQuantify(p.amount, this.entityDisplayText(p.crit)) + " to walls or floors in " + r + ".";
		},
		toComment: function(p) {
			return "A creature does not need to be alive to obtain pin credit. Sometimes a body chunk gets pinned but does not credit the challenge; keep retrying on different parts of a corpse until it works. \"Different regions\" means one pin per region, as many unique regions as pins required.";
		},
		toBinary: function(p) {
			var b = Array(7); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.amount);
			b[5] = this.enumToValue(p.crit, "creatures");
			b[6] = this.enumToValue(p.region, "regions");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoPopcornChallenge",
		category: "Opening popcorn plants",
		super: undefined,
		//	desc of format (< v1.32) ["0", "System.Int32|6|Amount|0|NULL", "0", "0"]
		//	or (>= v1.32) ["System.String|Any Region|Region|1|popcornregions", "System.Boolean|false|Different Regions|2|NULL", "System.Boolean|false|In one Cycle|3|NULL", "0", "System.Int32|7|Amount|0|NULL", "", "0", "0"]
		textUpgrade: {
			4: [
				{ op: "unshift", data: ["System.String|Any Region|Region|1|popcornregions", "System.Boolean|false|Different Regions|2|NULL", "System.Boolean|false|In one Cycle|3|NULL"] },
				{ op: "splice", offs: 5, rem: 0, data: [""] }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "region", type: "string",
				formatter: "popcornregions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Region", position: "1",
					formatter: "popcornregions", defaultval: "Any Region"
					}
				},
			{
				param: "differentRegions", type: "bool",
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
				param: "popRegions", type: "list",
				formatter: "regionsreal", parse: "list", separator: "|", minval: 0, maxval: 251, defaultval: []
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
				{ type: "icon", value: this.entityIconAtlas("Spear"), scale: 1, color: this.entityIconColor("Spear"), rotation: 0 },
				{ type: "icon", value: this.entityIconAtlas("SeedCob"), scale: 1, color: this.entityIconColor("SeedCob"), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
			if (p.differentRegions) {
				paint.splice(2, 0, { type: "icon", value: "TravellerA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			} else if (p.region !== "Any Region") {
				paint.splice(2, 0,
					{ type: "break" },
					{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
				);
			}
			if (p.oneCycle)
				paint.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			return paint;
		},
		toDesc: function(p) {
			var d = "Open " + this.entityNameQuantify(p.amount, "popcorn plants");
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
			if (p.region !== "Any Region" || p.differentRegions || p.popRegions.length) {
				var b = Array(6); b.fill(0);
				b[0] = this.challengeValue("BingoPopcornExChallenge");
				Bingovista.applyBool(b, 1, 4, p.oneCycle);
				Bingovista.applyBool(b, 1, 5, p.differentRegions);
				Bingovista.applyShort(b, 3, p.amount);
				b[5] = this.enumToValue(p.region, "popcornregions");
				for (var k = 0; k < p.popRegions.length; k++)
					b.push(this.enumToValue(p.popRegions[k], "popcornregions"));
				b.push(0);	//	zero terminator
				b[2] = b.length - GOAL_LENGTH;
				return new Uint8Array(b);
			}
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.oneCycle);
			Bingovista.applyShort(b, 3, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoRivCellChallenge",
		category: "Feeding the Rarefaction Cell to a Leviathan",
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
				{ type: "icon", value: "Symbol_EnergyCell", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Kill_BigEel", scale: 1, color: this.entityIconColor("BigEel"), rotation: 0 }
			];
		},
		toDesc: function(p) {
			return "Feed the Rarefaction Cell to a Leviathan (completes if you die).";
		},
		toComment: function(p) {
			return "The Rarefaction Cell's immense power challenges the cycle itself; hence, this goal is awarded even if the player dies in the process. Our cycles will meet again, little Water Dancer...";
		},
		toBinary: function(p) {
			var b = Array(3); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoSaintDeliveryChallenge",
		category: "Delivering the Music Pearl to Five Pebbles",
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
			var oracle = "pebbles";
			return [
				{ type: "icon", value: "memoriespearl", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
				{ type: "icon", value: this.maps.iterators.find(o => o.name === oracle).icon, scale: 1, color: this.maps.iterators.find(o => o.name === oracle).color, rotation: 0 }
			];
		},
		toDesc: function(p) {
			var oracle = "pebbles";
			return "Deliver the Music Pearl to " + this.maps.iterators.find(o => o.name === oracle).text + ".";
		},
		toComment: function(p) {
			return "Credit is awarded when Five Pebbles resumes playing the pearl; wait for dialog to finish, and place the pearl within reach.";
		},
		toBinary: function(p) {
			var oracle = "pebbles";
			var b = Array(3); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoSaintPopcornChallenge",
		category: "Eating popcorn plant seeds",
		super: undefined,
		//	desc of format ["0", "System.Int32|7|Amount|0|NULL", "0", "0"]
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
				{ type: "icon", value: "foodSymbol", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Symbol_Seed", scale: 1, color: this.entityIconColor("Default"), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Eat " + this.entityNameQuantify(p.amount, "popcorn plant seeds") + ".";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoStealChallenge",
		category: "Stealing items",
		super: undefined,
		//	desc of format ["System.String|Rock|Item|1|theft", "System.Boolean|false|From Scavenger Toll|0|NULL", "0", "System.Int32|3|Amount|2|NULL", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "subject", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "theft", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Item", position: "1",
					formatter: "theft", defaultval: "Rock"
				}
			},
			{
				param: "toll", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "From Scavenger Toll", position: "0",
					formatter: "NULL", defaultval: false
				}
			},
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
			},
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 1, binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "2",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
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
				{ type: "icon", value: "steal_item", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.entityIconAtlas(p.subject), scale: 1, color: this.entityIconColor(p.subject), rotation: 0 },
				(p.toll ?
					{ type: "icon", value: "scavtoll", scale: 0.8, color: Bingovista.colors.Unity_white, rotation: 0 } :
					{ type: "icon", value: this.entityIconAtlas("Scavenger"), scale: 1, color: this.entityIconColor("Scavenger"), rotation: 0 }
				),
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
			return paint;
		},
		toDesc: function(p) {
			return "Steal " + this.entityNameQuantify(p.amount, this.entityDisplayText(p.subject)) + " from " + (p.toll ? "a Scavenger Toll." : "Scavengers.");
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(6); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.subject, "theft");
			Bingovista.applyBool(b, 1, 4, p.toll);
			Bingovista.applyShort(b, 4, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoTameChallenge",
		category: "Befriending creatures",
		super: undefined,
		//	desc of format (< v1.091) ["System.String|EelLizard|Creature Type|0|friend", "0", "0"]
		//	or (>= v1.091) ["System.Boolean|true|Specific Creature Type|0|NULL", "System.String|BlueLizard|Creature Type|1|friend", "0", "System.Int32|3|Amount|3|NULL", "0", "0", ""]
		//	or (>= v1.3) ["System.Boolean|true|Specific Creature Type|0|NULL", "System.String|BlueLizard|Creature Type|1|friend", "0", "System.Int32|3|Amount|2|NULL", "0", "0", "", ""]
		textUpgrade: {
			3: [
				{ op: "unshift", data: ["System.Boolean|true|Specific Creature Type|0|NULL"] },
				{ op: "splice", offs: 2, rem: 0, data: ["0", "System.Int32|1|Amount|3|NULL"] },
				{ op: "push", data: ["", ""] }
			],
			7: [
				{ op: "push", data: [""] }
			]
		},
		textDowngrade: {},
		template: [
			{
				param: "specific", type: "bool",
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Specific Creature Type", position: "0",
					formatter: "NULL", defaultval: true
				}
			},
			{
				param: "crit", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "friend", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Creature Type", position: "1",
					formatter: "friend", defaultval: "BlueLizard"
				}
			},
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0
			},
			{
				param: "amount", type: "number",
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
				param: "tamedTypes", type: "list",
				formatter: "", parse: "list", separator: "cLtDT", minval: 0, maxval: 253, defaultval: []
			},
			{
				param: "tamedIDs", type: "list",
				formatter: "", parse: "list", separator: "cLtDID", minval: 0, maxval: 253, defaultval: []
			}
		],
		toPaint: function(p) {
			var paint = [
				{ type: "icon", value: "FriendB", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
			if (p.specific)
				paint.splice(1, 0, { type: "icon", value: this.entityIconAtlas(p.crit), scale: 1, color: this.entityIconColor(p.crit), rotation: 0 } );
			return paint;
		},
		toDesc: function(p) {
			return p.specific ?
					("Befriend " + this.entityNameQuantify(p.amount, this.entityDisplayText(p.crit)) + ".") :
					("Befriend " + ((p.amount == 1) ? " a creature." : String(p.amount) + " unique creature types."));
		},
		toComment: function(p) {
			return "Taming occurs when a creature has been fed or rescued enough times to increase the player's reputation above some threshold, starting from a default depending on species, and the global and regional reputation of the player.<br>" +
					"Feeding occurs when: 1. the player drops an edible item, creature or corpse, 2. within view of the creature, and 3. the creature bites that object. A \"happy lizard\" sound indicates success. The creature does not need to den with the item to increase reputation. Stealing the object back from the creature's jaws does not reduce reputation.<br>" +
					"A rescue occurs when: 1. a creature sees or is grabbed by a threat, 2. the player attacks the threat (if the creatures was grabbed, the predator must be stunned enough to drop the creature), and 3. the creature sees the attack (or gets dropped because of it).<br>" +
					"For the multiple-tame option, creature <i>types</i> count toward progress (multiple tames of a given type/color/species do not increase the count). Note that any befriendable creature type counts towards the total, including both Lizards and Squidcadas.";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			//	start with classic version...
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.crit, "friend");
			if (!p.specific || p.amount > 1) {
				//	...have to use expanded form
				b[0] = this.challengeValue("BingoTameExChallenge");
				Bingovista.applyBool(b, 1, 4, p.specific);
				b.push(p.amount);
			}
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoTradeChallenge",
		category: "Trading items to Merchants",
		super: undefined,
		//	desc of format ["0", "System.Int32|15|Value|0|NULL", "0", "0"]
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
					datatype: "System.Int32", name: "Value", position: "0",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
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
				{ type: "icon", value: "scav_merchant", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Trade " + String(p.amount) + " point" + (p.amount > 1 ? "s" : "") + " worth of items to Scavenger Merchants.";
		},
		toComment: function(p) {
			return "A trade occurs when: 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. When the Scavenger is also a Merchant, points will be awarded. Any item can be traded once to award points according to its value; this includes items initially held (then dropped/traded) by Scavenger Merchants. If an item seems to have been ignored or missed, try trading it again. (Item trade status is reset at start of cycle; items can be hoarded then used again.)<br>" +
					"Stealing and murder will <em>not</em> result in points being awarded.";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoTradeTradedChallenge",
		category: "Trading same items between merchants",
		super: undefined,
		//	desc of format ["0", "System.Int32|3|Amount of Items|0|NULL", "empty", "0", "0"]
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
					datatype: "System.Int32", name: "Amount of Items", position: "0",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "traderItems", type: "list",
				formatter: "", parse: "list", separator: ",", defaultval: ["empty"]
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
				{ type: "icon", value: "scav_merchant", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Menu_Symbol_Shuffle", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "scav_merchant", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Trade " + String(p.amount) + ((p.amount == 1) ? " item" : " items") + " from Scavenger Merchants to other Scavenger Merchants.";
		},
		toComment: function(p) {
			return "A trade occurs when: 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. While this challenge is active, any item dropped by a Merchant, due to a trade, will be \"blessed\" and thereafter bear a mark indicating its eligibility for this challenge.<br>" +
					"In a Merchant room, the Merchant bears a '<span style=\"color: #00ff00; font-weight: bold;\">✓</span>' tag to show who you should trade with; other Scavengers in the room are tagged with '<span style=\"color: #ff0000; font-weight: bold;\">X</span>'.<br>" +
					"A \"blessed\" item can then be brought to any <em>other</em> Merchant and traded, to award credit.<br>" +
					"Stealing from or murdering a Merchant will not result in \"blessed\" items dropping (unless they were already traded).";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoTransportChallenge",
		category: "Transporting creatures",
		super: undefined,
		//	desc of format ["System.String|Any Region|From Region|0|regions", "System.String|DS|To Region|1|regions", "System.String|CicadaA|Creature Type|2|transport", "", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "from", type: "string",
				binType: "number", binOffs: 0,  binSize: 1,
				formatter: "regions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "From Region", position: "0",
					formatter: "regions", defaultval: "SU"
				}
			},
			{
				param: "to", type: "string",
				binType: "number", binOffs: 1,  binSize: 1,
				formatter: "regions", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "To Region", position: "1",
					formatter: "regions", defaultval: "HI"
				}
			},
			{
				param: "crit", type: "string",
				binType: "number", binOffs: 2,  binSize: 1,
				formatter: "transport", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Creature Type", position: "2",
					formatter: "transport", altthreshold: 64, altformatter: "creatures", defaultval: "CicadaB"
				}
			},
			{
				param: "origins", type: "list",
				formatter: "", parse: "list", separator: "|", minval: 0, maxval: 251, defaultval: []
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
				{ type: "break" }
			];
			if (p.from !== "Any Region")
				paint.push( { type: "text", value: p.from, color: Bingovista.colors.Unity_white } );
			paint.push( { type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 } );
			if (p.to !== "Any Region")
				paint.push( { type: "text", value: p.to, color: Bingovista.colors.Unity_white } );
			return paint;
		},
		toDesc: function(p) {
			var r1 = this.regionToDisplayText(this.board.character, p.from),
				r2 = this.regionToDisplayText(this.board.character, p.to),
				d = "Transport " + this.entityNameQuantify(1, this.entityDisplayText(p.crit));
			if (r1 > "" || r2 > "") {
				if (r1 > "" && r2 > "")
					d += " from " + r1 + " to " + r2 + ".";
				else if (r1 > "")
					d += " out of " + r1 + ".";
				else // if (r2 > "")
					d += " to " + r2 + ".";
			}
			return d;
		},
		toComment: function(p) {
			return "When a specific 'From' region is selected, that creature can also be brought in from an outside region, placed on the ground, then picked up in that region, to activate it for the goal. Note: keeping a swallowable creature always in stomach will NOT count in this way, nor will throwing it up and only holding in hand (and not dropping then regrabbing).";
		},
		toBinary: function(p) {
			var b = Array(6); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.from, "regions");
			b[4] = this.enumToValue(p.to, "regions");
			if (this.enums.transport.includes(p.crit))
				b[5] = this.enumToValue(p.crit, "transport");
			else
				b[5] = this.enumToValue(p.crit, "creatures") + 64 - 1;	//	crit template altthreshold
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoUnlockChallenge",
		category: "Getting Arena Unlocks",
		//	desc of format ["System.String|SingularityBomb|Unlock|0|unlocks", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "unlock", type: "string",
				binType: "number", binOffs: 0, binSize: 2,
				formatter: "unlocks", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Unlock", position: "0",
					formatter: "unlocks", defaultval: "CC"
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
			var unl = this.maps.unlocks.find(o => o.name === p.unlock);
			//	unl of type: { type: "red", unlockColor: Bingovista.colors.RedColor, name: "GW-safari", text: "GW", icon: "", color: "" }
			var paint = [
				{ type: "icon", value: "arenaunlock", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" }
			];
			paint[0].color = unl.unlockColor;
			paint.push(
				(unl.icon === "") ?
				{ type: "text", value: p.unlock, color: Bingovista.colors.Unity_white } :
				{ type: "icon", value: unl.icon, scale: 1, color: unl.color, rotation: 0 }
			);
			return paint;
		},
		toDesc: function(p) {
			var unl = this.maps.unlocks.find(o => o.name === p.unlock);
			var d = unl.text;
			if (unl.type === "blue") {
				//	nop
			} else if (unl.type === "gold") {
				d = this.regionToDisplayText(this.board.character, d) + " Arenas";
			} else if (unl.type === "red") {
				d = this.regionToDisplayText(this.board.character, d) + " Safari";
			} else if (unl.type === "green") {
				d += " character";
			}
			return "Get the " + d + " unlock.";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, this.enumToValue(p.unlock, "unlocks"));
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoVistaChallenge",
		category: "Collecting Vistas",
		super: undefined,
		//	desc of format ["CC", "System.String|CC_A10|Room|0|vista", "734", "506", "0", "0"]
		textUpgrade: {
			6: [	//	Hack to use arbitrary string template
				{ op: "replace", offs: 1, find: /\|vista$/, replace: "|NULL" }
			]
		},
		textDowngrade: {
			6: [	//	and unhack...
				{ op: "replace", offs: 1, find: /\|NULL$/, replace: "|vista" }
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
				binType: "string", binOffs: 5, binSize: 0,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Room", position: "0",
					formatter: "NULL", defaultval: "SU_A04"
				}
			},
			{
				param: "x", type: "number",
				binType: "number", binOffs: 1, binSize: 2, signed: true,
				formatter: "", parse: "parseInt", minval: -INT_MAX, maxval: INT_MAX, defaultval: 265
			},
			{
				param: "y", type: "number",
				binType: "number", binOffs: 3, binSize: 2, signed: true,
				formatter: "", parse: "parseInt", minval: -INT_MAX, maxval: INT_MAX, defaultval: 415
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
				{ type: "icon", value: "vistaicon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: p.region, color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Collect the vista in " + this.regionToDisplayText(this.board.character, Bingovista.regionOfRoom(p.room)) + ".";
		},
		toComment: function(p) {
			var idx = this.maps.vistas.findIndex(o => o.room === p.room && o.x == p.x && o.y == p.y);
			return "Room: " + this.getMapLink(p.room, this.board.character) + " at x: " + String(p.x) + ", y: " + String(p.y) + "; is a " + ((idx >= 0) ? "stock" : "customized") + " location." + "<br>" +
					"Note: certain default Vista Points specify room names that are missing from some campaigns (<span class=\"bv-code\">GW_D01</span> and <span class=\"bv-code\">GW_E02</span> for Spearmaster/Artificer, and <span class=\"bv-code\">UW_C02</span> and <span class=\"bv-code\">UW_D05</span> for Rivulet). These are automatically fixed up to the correct room (<span class=\"bv-code\">GW_D01_PAST</span>, <span class=\"bv-code\">GW_E02_PAST</span>, <span class=\"bv-code\">UW_C02RIV</span>, <span class=\"bv-code\">UW_D05RIV</span> respectively) on loading the board. Either room name can be used to represent these vista points.<br>" +
					"Note: Rivulet <span class=\"bv-code\">UW_C02</span>'s coordinates are hard-coded to (450, 1170). To fully customize this room, specify <span class=\"bv-code\">UW_C02RIV</span> explicitly.";
		},
		toBinary: function(p) {
			var idx = this.maps.vistas.findIndex(o => o.room === p.room && o.x == p.x && o.y == p.y);
			var b;
			if (idx < 0) {
				//	Can't find in list, customize it
				b = Array(8); b.fill(0);
				b[0] = this.challengeValue(p._name);
				b[3] = this.enumToValue(p.region, "regions");
				Bingovista.applyShort(b, 4, p.x);
				Bingovista.applyShort(b, 6, p.y);
				b = b.concat([...new TextEncoder().encode(p.room)]);
				b[2] = b.length - GOAL_LENGTH;
			} else {
				//	Use stock list for efficiency
				b = Array(4); b.fill(0);
				b[0] = this.challengeValue("BingoVistaExChallenge");
				b[3] = idx + 1;
				b[2] = b.length - GOAL_LENGTH;
			}
			return new Uint8Array(b);
		}
	},
	{	//  Alternate enum version for as-generated locations
		name: "BingoVistaExChallenge",
		category: undefined,
		super: "BingoVistaChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "region", binType: "number", binOffs: 0, binSize: 1, formatter: "vista_region"
			},
			{
				param: "room", binType: "number", binOffs: 0, binSize: 1, formatter: "vista_room"
			},
			{
				param: "x", binType: "number", binOffs: 0, binSize: 1, formatter: "vista_x"
			},
			{
				param: "y", binType: "number", binOffs: 0, binSize: 1, formatter: "vista_y"
			}
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	//	Challenges are alphabetical up to here (initial version); new challenges/variants added chronologically below
	//	added 0.86 (in 0.90 update cycle)
	{
		name: "BingoEnterRegionFromChallenge",
		category: "Entering a region from another region",
		super: undefined,
		//	desc of format ["System.String|GW|From|0|regionsreal", "System.String|SH|To|0|regionsreal", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "from", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "regionsreal", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "From", position: "0",
					formatter: "regionsreal", defaultval: "SU"
				}
			},
			{
				param: "to", type: "string",
				binType: "number", binOffs: 1, binSize: 1,
				formatter: "regionsreal", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "To", position: "0",
					formatter: "regionsreal", defaultval: "HI"
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
				{ type: "text", value: p.from, color: Bingovista.colors.Unity_white },
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.EnterFrom, rotation: 90 },
				{ type: "text", value: p.to, color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "First time entering " + this.regionToDisplayText(this.board.character, p.to) + " must be from " + this.regionToDisplayText(this.board.character, p.from) + ".";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.from, "regionsreal");
			b[4] = this.enumToValue(p.to, "regionsreal");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoMoonCloakChallenge",
		category: "Collecting or delivering Moon's cloak",
		super: undefined,
		//	desc of format ["System.Boolean|false|Deliver|0|NULL", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "deliver", type: "bool",
				binType: "bool", binOffs: 0, bit: 4,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Boolean", name: "Deliver", position: "0",
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
			var paint = [ { type: "icon", value: "Symbol_MoonCloak", scale: 1, color: this.entityIconColor("MoonCloak"), rotation: 0 } ];
			if (p.deliver)
				paint.push(
					{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
					{ type: "icon", value: "GuidanceMoon", scale: 1, color: Bingovista.colors.GuidanceMoon, rotation: 0 }
				);
			return paint;
		},
		toDesc: function(p) {
			return (p.deliver) ? "Deliver the Cloak to Moon." : "Collect Moon's Cloak.";
		},
		toComment: function(p) {
			return "With only a 'Deliver' goal on the board, players will spawn with the Cloak in the starting shelter, and must deliver it to Looks To The Moon to complete the goal. If both Obtain and Deliver are present, players must obtain the Cloak from Submerged Superstructure first, and then deliver it, to complete the respective goals.";
		},
		toBinary: function(p) {
			var b = Array(3); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyBool(b, 1, 4, p.deliver);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{	//	added v1.09
		name: "BingoBroadcastChallenge",
		category: "Collecting broadcasts",
		super: undefined,
		//	desc of format ["System.String|Chatlog_SI3|Broadcast|0|chatlogs", "0", "0"]
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "chatlog", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "chatlogs", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Broadcast", position: "0",
					formatter: "chatlogs", defaultval: "Chatlog_CC0"
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
				{ type: "icon", value: "arenaunlock", scale: 1, color: Bingovista.colors.WhiteColor, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: p.chatlog.substring(p.chatlog.indexOf("_") + 1), color: Bingovista.colors.Unity_white },
				{ type: "icon", value: "Symbol_Satellite", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
			];
		},
		toDesc: function(p) {
			var r = p.chatlog.substring(p.chatlog.indexOf("_") + 1);
			if (r.search(/[0-9]/) >= 0) r = r.substring(0, r.search(/[0-9]/));
			r = this.regionToDisplayText(this.board.character, r);
			if (r > "") r = ", in " + r;
			return "Collect the " + p.chatlog + " broadcast" + r + ".";
		},
		toComment: function(p) {
			return "The broadcast can be found in room: " + this.getMapLink(this.maps.chatlogs.find(o => o.name === p.chatlog).room, this.board.character) + ".";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.chatlog, "chatlogs");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{	//	added v1.092
		name: "BingoDamageExChallenge",
		category: undefined,
		super: "BingoDamageChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "weapon", binType: "number", binOffs: 0,  binSize: 1, formatter: "weapons"
			},
			{
				param: "victim", binType: "number", binOffs: 1,  binSize: 1, formatter: "creatures"
			},
			{
				param: "amount", binType: "number", binOffs: 2,  binSize: 2
			},
			{
				param: "inOneCycle", binType: "bool", binOffs: 0, bit: 4
			},
			{
				param: "region", binType: "number", binOffs: 4, binSize: 1, formatter: "regions"
			},
			{
				param: "subregion", binType: "number", binOffs: 5, binSize: 1, formatter: "subregions"
			}
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	{
		name: "BingoTameExChallenge",
		category: undefined,
		super: "BingoTameChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "specific", binType: "bool", binOffs: 0, bit: 4
			},
			{
				param: "crit", binType: "number", binOffs: 0, binSize: 1, formatter: "friend"
			},
			{
				param: "amount", binType: "number", binOffs: 1, binSize: 1
			}
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	{	//	added v1.2
		name: "BingoBombTollExChallenge",
		category: undefined,
		super: "BingoBombTollChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "specific", binType: "bool", binOffs: 0, bit: 5
			},
			{
				param: "roomName", binType: "number", binOffs: 0, binSize: 1, formatter: "tolls"
			},
			{
				param: "pass", binType: "bool", binOffs: 0, bit: 4
			},
			{
				param: "amount", binType: "number", binOffs: 1, binSize: 1
			},
			{
				param: "bombed", binType: "string", binOffs: 2, binSize: 0, formatter: "tolls_bombed", defaultval: ["empty"]
			},
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	{
		name: "BingoEchoExChallenge",
		category: undefined,
		super: "BingoEchoChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{	//	if binType is omitted, defaultval is used as fallback
				param: "specific", defaultval: false
			},
			{
				param: "ghost", binType: "number", binOffs: 0, binSize: 1, formatter: "echoes"
			},
			{
				param: "starve", binType: "bool", binOffs: 0, bit: 4
			},
			{
				param: "amount", binType: "number", binOffs: 1, binSize: 1
			},
			{
				param: "visited", binType: "string", binOffs: 2, binSize: 0, formatter: "regions", defaultval: []
			}
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	{
		name: "BingoDodgeNootChallenge",
		category: "Dodging Noodlefly attacks",
		super: undefined,
		//	desc of format ["System.Int32|6|Amount|0|NULL", "0", "0", "0"]
		//	amount, current, completed, revealed
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "amount", type: "number",
				binType: "number", binOffs: 0, binSize: 2,
				formatter: "", parse: "SettingBox", parseFmt: {
					datatype: "System.Int32", name: "Amount", position: "0",
					formatter: "NULL", minval: 1, maxval: INT_MAX, defaultval: 1
				}
			},
			{
				param: "current", type: "number",
				formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0
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
				{ type: "icon", value: this.entityIconAtlas("BigNeedleWorm"), scale: 1, color: this.entityIconColor("BigNeedleWorm"), rotation: 0 },
				{ type: "icon", value: "slugtarget", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Dodge [" + String(p.current) + "/" + String(p.amount) + "] Noodlefly attacks.";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			Bingovista.applyShort(b, 3, p.amount);
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoDontKillChallenge",
		category: "Avoiding killing creatures",
		super: undefined,
		//	desc of format ["System.String|DaddyLongLegs|Creature Type|0|creatures", "0", "0"]
		//	victim, completed, revealed
		textUpgrade: {},
		textDowngrade: {},
		template: [
			{
				param: "victim", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "creatures", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Creature Type", position: "0",
					formatter: "creatures", defaultval: "CicadaA"
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
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
				{ type: "icon", value: "Multiplayer_Bones", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
			];
			if (p.victim !== "Any Creature")
				paint.push( { type: "icon", value: this.entityIconAtlas(p.victim), scale: 1, color: this.entityIconColor(p.victim), rotation: 0 } );
			return paint;
		},
		toDesc: function(p) {
			return "Never kill " + this.entityDisplayText(p.victim) + ".";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.victim, "creatures");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoGourmandCrushChallenge",
		category: "Crushing creatures",
		super: undefined,
		//	desc of format ["0", "System.Int32|9|Amount|0|NULL", "0", "0", ""]
		//	current, amount, completed, revealed, crushed
		textUpgrade: {},
		textDowngrade: {},
		template: [
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
			},
			{
				param: "crushed", type: "list",
				formatter: "", parse: "list", separator: "|", minval: 0, maxval: 253, defaultval: []
			}
		],
		toPaint: function(p) {
			return [
				{ type: "icon", value: "gourmcrush", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Crush " + ((p.amount > 1) ? (String(p.amount) + " unique creatures") : ("a creature")) + " by falling.";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = p.amount;
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoIteratorChallenge",
		category: "Visiting Iterators",
		super: undefined,
		//	desc of format ["System.Boolean|false|Looks to the Moon|0|NULL", "0", "0"]
		textUpgrade: {
			3: [	//	Transform boolean to string SettingBox; futureproofing for expanded iterator selection
				{ op: "replace", offs: 0, find: /^System\.Boolean\|/, replace: "System.String|" },
				{ op: "replace", offs: 0, find: /\|NULL$/, replace: "|iterators" }
			]
		},
		textDowngrade: {
			3: [	//	unhack
				{ op: "replace", offs: 0, find: /^System\.String\|/, replace: "System.Boolean|" },
				{ op: "replace", offs: 0, find: /\|iterators$/, replace: "|NULL" }
			]
		},
		template: [
			{
				param: "oracle", type: "string",
				binType: "number", binOffs: 0, binSize: 1,
				formatter: "iterators", parse: "SettingBox", parseFmt: {
					datatype: "System.String", name: "Looks to the Moon", position: "0",
					formatter: "iterators", defaultval: "false"
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
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
				{ type: "icon", value: this.maps.iterators.find(o => o.name === p.oracle).icon, scale: 1, color: this.maps.iterators.find(o => o.name === p.oracle).color, rotation: 0 }
			];
		},
		toDesc: function(p) {
			return "Visit " + this.maps.iterators.find(o => o.name === p.oracle).text + ".";
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.oracle, "iterators");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoItemHoardExChallenge",
		category: undefined,
		super: "BingoItemHoardChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "anyShelter", binType: "bool", binOffs: 0, bit: 4
			},
			{
				param: "amount", binType: "number", binOffs: 0, binSize: 1
			},
			{
				param: "target", binType: "number", binOffs: 1, binSize: 1, formatter: "expobject"
			},
			{
				param: "region", binType: "number", binOffs: 2, binSize: 1, formatter: "regions"
			}
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	{
		name: "BingoLickChallenge",
		category: "Getting licked by lizards",
		super: undefined,
		//	desc of format ["0", "System.Int32|{0}|Amount|0|NULL", "0", "0", ""]
		textUpgrade: {},
		textDowngrade: {},
		template: [
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
			},
			{
				param: "lickers", type: "list",
				formatter: "", parse: "list", separator: "|", minval: 0, maxval: 253, defaultval: []
			}
		],
		toPaint: function(p) {
			return [
				{ type: "icon", value: "lizlick", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		},
		toDesc: function(p) {
			return "Get licked by " + ((p.amount > 1) ? (String(p.amount) + " different individual lizards.") : ("a lizard."));
		},
		toComment: function(p) {
			return "";
		},
		toBinary: function(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = p.amount;
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
	},
	{
		name: "BingoHatchNoodleExChallenge",
		category: undefined,
		super: "BingoHatchNoodleChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "region", binType: "number", binOffs: 1, binSize: 1, formatter: "nootregions"
			},
			{
				param: "differentRegions", binType: "bool", binOffs: 0, bit: 5
			},
			{
				param: "oneCycle", binType: "bool", binOffs: 0, bit: 4
			},
			{
				param: "amount", binType: "number", binOffs: 0, binSize: 1
			},
			{
				param: "hatchRegions", binType: "string", binOffs: 2, binSize: 0,
				formatter: "nootregions", defaultval: []
			}
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	{
		name: "BingoPopcornExChallenge",
		category: undefined,
		super: "BingoPopcornChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "region", binType: "number", binOffs: 2, binSize: 1, formatter: "popcornregions"
			},
			{
				param: "differentRegions", binType: "bool", binOffs: 0, bit: 5
			},
			{
				param: "oneCycle", binType: "bool", binOffs: 0, bit: 4
			},
			{
				param: "amount", binType: "number", binOffs: 0, binSize: 2
			},
			{
				param: "popRegions", binType: "string", binOffs: 3, binSize: 0, formatter: "regionsreal", defaultval: []
			},
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	},
	{
		name: "BingoKarmaFlowerExChallenge",
		category: undefined,
		super: "BingoKarmaFlowerChallenge",
		textUpgrade: undefined,
		textDowngrade: undefined,
		template: [
			{
				param: "region", binType: "number", binOffs: 2, binSize: 1, formatter: "regions"
			},
			{
				param: "differentRegions", binType: "bool", binOffs: 0, bit: 5
			},
			{
				param: "oneCycle", binType: "bool", binOffs: 0, bit: 4
			},
			{
				param: "amount", binType: "number", binOffs: 0, binSize: 2
			},
			{
				param: "eatRegions", binType: "string", binOffs: 3, binSize: 0, formatter: "regions", defaultval: []
			}
		],
		toPaint: undefined,
		toDesc: undefined,
		toComment: undefined,
		toBinary: undefined
	}
];


/*                           *
 * * * Testing Functions * * *
 *                           */

/**
 *	Quickly sets the meta / header data for a parsed text board.
 *	Has no effect if the header table is not yet placed.
 *	@param comm       String to set as comment / title
 *	@param character  Selected character; one of this.enums.characters[].text,
 *	                  or "Any" if other
 *	@param shelter    Shelter to start in, or "" if random
 *	@param perks      List of perks to enable.  Array of integers, each indexing
 *	                  this.enums.expflags[].  For example, the list [0, 5, 13, 14, 16]
 *	                  would enable: "Perk: Scavenger Lantern", "Perk: Karma Flower", "Perk:
 *	                  Item Crafting", "Perk: High Agility", "Burden: Blinded" (ordering of
 *	                  this array is not checked, and repeats are ignored)
 *	Parameters are optional; an absent parameter leaves the existing value alone.
 *	Call with no parameters to see usage.
 */
setMeta() {
	var comm = arguments[0], character = arguments[1];
	var shelter = arguments[2], perks = arguments[3];

	if (board === undefined || document.getElementById("hdrttl") === null
			|| document.getElementById("hdrchar") === null
			|| document.getElementById("hdrshel") === null) {
		console.log("Need a board to set.");
		return;
	}

	if (comm !== undefined)
		document.getElementById("hdrttl").value = comm;
	if (character !== undefined)
		document.getElementById("hdrchar").innerText = character;
	if (shelter !== undefined) {
		if (shelter === "random") shelter = "";
		document.getElementById("hdrshel").value = shelter;
	}
	if (perks !== undefined) {
		for (var i = 0, el; i < this.maps.expflags.length; i++) {
			el = document.getElementById("perkscheck" + String(i));
			if (el === null)
				break;
			if (perks.includes(i))
				el.setAttribute("checked", "");
			else
				el.removeAttribute("checked");
		}
	}
	if (comm !== undefined || character !== undefined
			|| shelter !== undefined || perks !== undefined) {
		console.log("Updated.");
		parseButton();
		return;
	}
	console.log("setMeta(comm, character, shelter, perks)\n"
	          + "Quickly sets the meta / header data for a parsed text board.\n"
	          + "     comm   String to set as comment / title\n"
	          + "character   Selected character; one of this.enums.characters, or \"Any\" if other.\n"
	          + "  shelter   Shelter to start in, or \"\" if random.\n"
	          + "    perks   List of perks to enable.  Array of integers, each indexing this.maps.expflags[].\n"
	          + "For example, the list [0, 5, 13, 14, 16] would enable: \"Perk: Scavenger Lantern\",\n"
	          + "\"Perk: Karma Flower\", \"Perk: Item Crafting\", \"Perk: High Agility\", \"Burden: Blinded\".\n"
	          + "(Ordering of this array doesn't matter, and repeats are ignored.)\n"
	          + "Parameters are optional; an absent parameter leaves the existing value alone.\n"
	          + "Call with no parameters to get usage.\n"
	          + "Example:  setMeta(\"New Title\", \"White\", \"SU_S05\", [])\n"
	          + "-> sets the title, character and shelter, and clears perks.\n"
	);
}

enumeratePerks() {
	var a = [];
	for (var i = 0, el; i < this.maps.expflags.length; i++) {
		el = document.getElementById("perkscheck" + String(i));
		if (el !== null) {
			if (el.checked)
				a.push(i);
		} else
			break;
	}
	return a;
}

compressionRatio() {
	return Math.round(1000 - 1000 * board.bin.length / document.getElementById("textbox").value.length) / 10;
}

/**	approx. room count in Downpour, adding up Wiki region room counts */
TOTAL_ROOM_COUNT = 1578;

/**
 *	Counts the total number of possible values/options for a given goal
 *	type (g indexing in CHALLENGE_DEFS).
 *
 *	TODO: bring in patches from below
 */
countGoalOptions(g) {
	g = parseInt(g);
	var count = 1;
	if (g < 0 || g >= this.CHALLENGE_DEFS.length) return;
	var desc = this.CHALLENGE_DEFS[g];
	for (var i = 0; i < desc.params.length; i++) {
		if (desc.params[i].type === "bool") {
			count *= 2;
		} else if (desc.params[i].type === "number") {
			if (desc.params[i].formatter === "") {
				if (desc.params[i].size == 1) {
					//	Known uses: desc.name in ["BingoAllRegionsExceptChallenge", "BingoHatchNoodleChallenge", "BingoHellChallenge", "BingoItemHoardChallenge"]
					count *= CHAR_MAX + 1;
				} else if (desc.params[i].size == 2) {
					count *= INT_MAX + 1;
				} else {
					console.log("Unexpected value: CHALLENGE_DEFS["
							+ g + "].params[" + i + "].size: " + desc.params[i].size);
				}
			} else {
				if (this.enums[desc.params[i].formatter] === undefined) {
					console.log("Unexpected formatter: CHALLENGE_DEFS["
							+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
				} else {
					count *= this.enums[desc.params[i].formatter].length;
				}
			}
		} else if (desc.params[i].type === "string" || desc.params[i].type === "pstr") {
			var exponent = desc.params[i].size;
			if (exponent == 0) {
				//	Known uses: desc.name in ["BingoChallenge", "BingoAllRegionsExceptChallenge", "BingoVistaChallenge"]
				//	Variable length; customize based on goal
				if (desc.name === "BingoChallenge" && i == 0) {
					//	Plain (UTF-8) string
					exponent = 0;
				} else if (desc.name === "BingoAllRegionsExceptChallenge" && i == 2) {
					//	Can assign arbitrary sets of regions here; usually, set to everything but the target region so 0 degrees of freedom
					exponent = 0;
				} else if (desc.name === "BingoVistaChallenge" && i == 1) {
					//	String selects room name
					exponent = 0;
					count *= TOTAL_ROOM_COUNT;	//	approx. room count in Downpour, adding up Wiki region room counts
				}
			}
			if (desc.params[i].formatter === "") {
				for (var j = 0; j < exponent; j++)
					count *= 256;
			} else if (this.enums[desc.params[i].formatter] === undefined) {
				console.log("Unexpected formatter: CHALLENGE_DEFS["
						+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
			} else {
				for (var j = 0; j < exponent; j++)
					count *= this.enums[desc.params[i].formatter].length - 1;
			}
		} else {
			console.log("Unsupported type: CHALLENGE_DEFS["
					+ g + "].params[" + i + "].type: " + desc.params[i].type);
		}
	}

	return count;
}

/**
 *	Use binToGoal(binGoalFromNumber(g, Math.random())) to generate truly
 *	random goals.
 *	Warning, may be self-inconsistent (let alone with others on a board!).
 *	@param g goal index (in CHALLENGE_DEFS[]) to generate.
 *	@param n floating point value between 0...1; arithmetic encoded sequence
 *	of parameters.
 */ 
binGoalFromNumber(g, n) {
	g = parseInt(g);
	if (g < 0 || g >= this.CHALLENGE_DEFS.length) return;
	n = parseFloat(n);
	if (isNaN(n) || n < 0 || n >= 1) return;
	var r = new Uint8Array(255 + GOAL_LENGTH);
	var bytes = 0;
	var val;
	var def = this.CHALLENGE_DEFS[g], t = def.template;
	r[0] = g;
	for (var i = 0; i < t.length; i++) {
		if (t[i].binType === "bool") {
			n *= 2;
			val = Math.floor(n);
			n -= val;
			r[1 + t[i].binOffs] |= (val << t[i].bit);
			bytes = Math.max(bytes, t[i].binOffs - 1);
		} else if (t[i].binType === "number") {
			val = 0;
			if (desc.name === "BingoMaulTypesChallenge") {
				n *= this.enums["creatures"].length + 1;
			} else if (t[i].formatter === "regionsreal" ||
			           t[i].formatter === "echoes") {
				n *= this.enums[t[i].formatter].length - 1;
				val = 2;	//	exclude "Any Region" option
			} else if (t[i].formatter === "") {
				val = 1;	//	no use-cases for zero amount
				if (t[i].size == 1) {
					n *= CHAR_MAX;
				} else if (t[i].size == 2) {
					n *= INT_MAX;
				} else {
					console.log("Unexpected value: CHALLENGE_DEFS["
							+ g + "].params[" + i + "].size: " + t[i].size);
				}
			} else if (this.enums[t[i].formatter] === undefined) {
				console.log("Unexpected formatter: CHALLENGE_DEFS["
						+ g + "].params[" + i + "].formatter: " + t[i].formatter);
			} else {
				n *= this.enums[t[i].formatter].length;
				val = 1;
			}
			val += Math.floor(n);
			n -= Math.floor(n);
			if (t[i].size == 1) {
				r[GOAL_LENGTH + t[i].binOffs] = val;
			} else if (t[i].size == 2) {
				Bingovista.applyShort(r, GOAL_LENGTH + t[i].binOffs, val);
			} else {
				//	add more apply-ers here
			}
			bytes = Math.max(bytes, t[i].binOffs + t[i].size);
		} else if (t[i].binType === "string") {
			if (t[i].size == 0) {
				//	Known uses: desc.name in ["BingoChallenge", "BingoAllRegionsExcept", "BingoVistaChallenge", "BingoBombTollExChallenge", BingoEchoExChallenge"]
				//	Variable length; customize based on goal
				if (desc.name === "BingoChallenge" && i == 0) {
					//	Plain (UTF-8) string, any length
					val = "Title Text!";
					val = new TextEncoder().encode(val);
				} else if (desc.name === "BingoAllRegionsExcept" && i == 2) {
					//	Can assign an arbitrary set of regions here
					//	usually is set to all regions (0 degrees of freedom)
					val = Array(this.enums[t[i].formatter].length);
					for (var j = 0; j < val.length - 1; j++) val[j] = j + 2;
				} else if (desc.name === "BingoVistaChallenge" && i == 1) {
					//	String selects room name; don't have a list of these, use a descriptive identifier instead
					n *= TOTAL_ROOM_COUNT;
					val = Math.floor(n);
					n -= val;
					val = "room_" + String(val);
					val = new TextEncoder().encode(val);
				} else if (desc.name === "BingoBombTollExChallenge" || desc.name === "BingoEchoExChallenge") {
					//	list of bombed tolls or visited echoes; default empty
					val = [];
				} else {
					console.log("Unknown use of type \"string\", size = 0, in " +
							"CHALLENGE_DEFS[" + g + "].params[" + i + "]");
				}
				for (var j = 0; j < val.length; j++)
					r[GOAL_LENGTH + t[i].binOffs + j] = val[j];
				bytes = Math.max(bytes, t[i].binOffs + val.length);
			} else {
				val = Array(t[i].size);
				bytes = Math.max(bytes, t[i].binOffs + t[i].size);
				if (this.enums[t[i].formatter] !== "" &&
						this.enums[t[i].formatter] === undefined) {
					console.log("Unexpected formatter: CHALLENGE_DEFS["
							+ g + "].params[" + i + "].formatter: " + t[i].formatter);
				} else {
					for (var j = 0; j < t[i].size; j++) {
						if (this.enums[t[i].formatter] === "") {
							n *= 256;
						} else {
							n *= this.enums[t[i].formatter].length;
						}
						val = Math.floor(n);
						n -= val;
						r[GOAL_LENGTH + t[i].binOffs + j] = val;
						if (this.enums[t[i].formatter] > "")
							r[GOAL_LENGTH + t[i].binOffs + j]++;
					}
				}
			}
		} else if (t[i].binType === "pstr") {
			console.log("Unimplemented type: \"pstr\" in " |
					"CHALLENGE_DEFS[" + g + "].params[" + i + "]");
		} else {
			console.log("Unsupported binType: CHALLENGE_DEFS["
					+ g + "].params[" + i + "].type: " + t[i].type);
		}
	}
	r[2] = bytes;

	return r.subarray(0, bytes + GOAL_LENGTH);
}

/**
 *	Generates n goals, of type g (index in CHALLENGE_DEFS),
 *	with very random settings.
 */
generateRandomGoals(g, n) {
	g = parseInt(g);
	if (g < 0 || g >= this.CHALLENGE_DEFS.length) return;
	n = parseInt(n);
	if (n < 0) return;
	var goals = [];
	for (var i = 0; i < n; i++) {
		goals.push(binToGoal(binGoalFromNumber(g, Math.random())));
	}
	return goals;
}

/**	Exclude these challenge indices from generation: */
GENERATE_BLACKLIST = [
	"BingoChallenge",       	//	Base class, useless in game
	"BingoVistaChallenge",  	//	full-general vista goal can't generate real room names
//	"BingoEchoChallenge",   	//	exclude less-featureful legacy versions:
//	"BingoItemHoardChallenge",
//	"BingoBombTollChallenge",
//	"BingoDamageChallenge",
];

//	patch up with:
patchBlacklist() {
	[
		"BingoEchoChallenge",
		"BingoItemHoardChallenge",
		"BingoBombTollChallenge",
		"BingoDamageChallenge"
	].forEach(
		s => GENERATE_BLACKLIST.push(this.challengeValue(s))
	);
	GENERATE_BLACKLIST.sort( (a, b) => a - b );
}

initGenerateBlacklist() {
	for (var i = 0; i < GENERATE_BLACKLIST.length; i++) {
		GENERATE_BLACKLIST[i] = this.challengeValue(GENERATE_BLACKLIST[i]);
	}
}

/**
 *	Generates n goals, of random types, with *very* random settings.
 */
generateRandomRandomGoals(n) {
	n = parseInt(n);
	if (n < 0) return;
	var s = this.enums.characters[Math.floor(Math.random() * this.enums.characters.length)] + ";";
	for (var i = 0; i < n; i++) {
		if (i > 0) s += "bChG";
		//	Try generating goals until one passes
		//	the raw encoding supports some disallowed values; filter them out
		var goalNum, goalTxt = "", goal, retries;
		goalNum = Math.floor(Math.random() * (this.CHALLENGE_DEFS.length - GENERATE_BLACKLIST.length));
		for (var j = 0; j < GENERATE_BLACKLIST.length; j++) {
			if (goalNum >= GENERATE_BLACKLIST[j]) goalNum++;
		}
		for (retries = 0; retries < 100; retries++) {
			goalTxt = binToGoal(binGoalFromNumber(goalNum, Math.random()));
			try {
				goal = Bingovista.CHALLENGES[goalTxt.split("~")[0]](goalTxt.split("~")[1].split(/></), s);
			} catch (e) {
				goalTxt = "";
			}
			if (goalTxt > "") break;
		}
		if (retries >= 100) console.log("Really bad luck trying to generate a goal");
		s += goalTxt;
	}
	document.getElementById("textbox").value = s;

	return s;
}

/**
 *	Generates one random example of each possible goal type.
 */
generateOneOfEverything() {
	var s = "White;", goalNum;
	for (var i = 0; i < this.CHALLENGE_DEFS.length - GENERATE_BLACKLIST.length; i++) {
		goalNum = i;
		for (var j = 0; j < GENERATE_BLACKLIST.length; j++) {
			if (goalNum >= GENERATE_BLACKLIST[j]) goalNum++;
		}
		var goal = binToGoal(binGoalFromNumber(goalNum, Math.random()));
		s += goalToText(goal) + "bChG";
	}
	s = s.substring(0, s.length - 4);
	document.getElementById("textbox").value = s;
	parseButton();
}

/* * * End of class * * */
}

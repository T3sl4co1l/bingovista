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
const VERSION_MAJOR   =  1, VERSION_MINOR = 30;	/**< Supported mod version */
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

pluralReplacers = [
	{ regex: /Mice$/,   text: "Mouse" },
	{ regex: /ies$/,    text: "y"     },
	{ regex: /ches$/,   text: "ch"    },
	{ regex: /Larvae$/, text: "Larva" },
	{ regex: /s$/,      text: ""      },
];

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
	"popcorn_plant":       "#68283a",
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
	//this.binGoalToText           = this.binGoalToText.bind(this);
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
		{ name: "KarmaFlower",      text: "Karma Flowers",      icon: "Symbol_KarmaFlower",    color: "#e7df90" },
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
		{ name: "SeedCob",          text: "Popcorn Plants",     icon: "popcorn_plant",         color: "#68283a" },
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
	for (var g of this.BINARY_TO_STRING_DEFINITIONS) {
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
	this.enums.tolls_bombed = [ "empty", "SU_C02|false", "GW_C05|false", "GW_C11|false",
		"LF_E03|false", "UG_TOLL|false", "CL_A34|false", "CL_B27|false", "LC_C10|false",
		"LC_longslum|false", "LC_rooftophop|false", "LC_templetoll|false",
		"LC_stripmallNEW|false", "LF_J01|false", "OE_TOWER04|false", "SB_TOPSIDE|false",
		"SU_C02|true", "GW_C05|true", "GW_C11|true", "LF_E03|true", "UG_TOLL|true",
		"CL_A34|true", "CL_B27|true", "LC_C10|true", "LC_longslum|true",
		"LC_rooftophop|true", "LC_templetoll|true", "LC_stripmallNEW|true", "LF_J01|true",
		"OE_TOWER04|true", "SB_TOPSIDE|true" ];
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
			+ o.room + "|Room|0|vista><" + String(o.x) + "><" + String(o.y));
	this.enums.weapons = [ "Any Weapon", "Spear", "Rock", "ScavengerBomb", "JellyFish",
		"PuffBall", "LillyPuck", "SingularityBomb" ];
	this.enums.weaponsnojelly = this.enums.weapons.slice(0);

	//	from Watcher update
	this.maps.characters.push( { name: "Watcher", text: "Watcher", color: "#17234e", icon: "Kill_Slugcat" } );
	this.enums.characters.push("Watcher");
	this.maps.unlocks.push( { type: "blue", unlockColor: Bingovista.colors.AntiGold, name: "SeedCob", text: "Popcorn Plants", icon: "popcorn_plant", color: "#68283a" } );
	this.enums.unlocks.push("SeedCob");

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
		goals: [Bingovista.CHALLENGES["BingoChallenge"].call(this, ["empty"])],
		toBin: undefined,
		text: "",
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
		data: Bingovista.binToBase64u(this.board.toBin),
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
			rows[names[i]] = rows[names[i]].children[j];
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

	//	set header elements
	while (title.childNodes.length) title.removeChild(title.childNodes[0]);
	title.appendChild(document.createTextNode(this.board.comments || "Untitled"));
	while (size.childNodes.length) size.removeChild(size.childNodes[0]);
	size.appendChild(document.createTextNode(String(this.board.width) + " x " + String(this.board.height)));
	while (char.childNodes.length) char.removeChild(char.childNodes[0]);
	char.appendChild(document.createTextNode(this.board.character || "Any"));
	while (shel.childNodes.length) shel.removeChild(shel.childNodes[0]);
	if (this.board.shelter)
		shel.innerHTML = this.getMapLink(this.board.shelter, this.board.character);
	else
		shel.appendChild(document.createTextNode("random"));

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
	//	If content is "trusted", let it use HTML; else, escape it because it contains board text that's illegal HTML
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


/*                                                *
 *	Formatting and Challenge Helper Functions * * *
 *                                                */

/**
 *	Check the challenge descriptor part s is a valid SettingBox, matching the specified template.
 *	@param s  string to validate
 *	@param template  object of the form:
 *	{
 *		datatype: "System.Int32",	//	Field type; acceptable values: "System.Boolean", "System.Int32", "System.String"
 *		name: "Amount",   	//	Field label as displayed in the menu
 *		position: "2",    	//	Field position on the menu
 *		formatter: "NULL",	//	Field list name (type System.String: also enum list to check against; Int, Bool: should be "NULL")
 *		altformatter: ""  	//	(type System.String) alternative list to check against; if the value isn't found in either formatter list, an error is returned
 *		altthreshold: 64  	//	(type System.String) base index for the altformatter list
 *		minval: 1,        	//	(type System.Int32) minimum value
 *		maxval: CHAR_MAX, 	//	(type System.Int32) maximum value
 *		defaultval: 1     	//	Default value (returned when a non-fatal error has occurred)
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
			rr.error.push("invalid Boolean value; using default");
		}
	} else if (ar[0] === "System.Int32") {
		var num = parseInt(ar[1]);
		if (isNaN(num)) {
			rr.error.push("Int32 value " + ar[1] + " not a number; using default");
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
		rr.index = this.enums[template.formatter].indexOf(template.defaultval);
		//	validate which kind of string it is
		if (ar[4] !== template.formatter && ar[4] !== template.altformatter) {
			rr.error.push("unexpected list \"" + ar[4] + "\"");
		} else if (template.formatter === "NULL") {
			rr.value = ar[1];	//	raw string
			rr.index = -1;
		} else {
			rr.index = (this.enums[template.formatter].indexOf(template.defaultval) >= 0) ? (this.enums[template.formatter].indexOf(template.defaultval)) : (this.enums[template.altformatter]?.indexOf(template.defaultval) + template.altthreshold);
			var idx1 = this.enums[template.formatter].indexOf(ar[1]);
			var idx2 = this.enums[template.altformatter]?.indexOf(ar[1]) || -1;
			if (idx1 < 0 && idx2 < 0) {
				rr.error.push("value not found in list; using default");
			} else {
				rr.value = ar[1];
				rr.index = (idx1 >= 0) ? idx1 : idx2 + template.altthreshold;
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
 *	@param desc      parameter list / descriptor; (plain text).split("><")
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
 *		type      	string, primitive type assigned to [param]; one of "bool",
 *		          	"number", "string", "list"; used to read/format parameters
 *		          	after creation ("list" type is only used for an array of
 *		          	string elements, keyed from formatter)
 *		formatter 	string, name of enum list (in this.enums) to select from
 *		          	(string type)
 *		parse     	parser used to extract the value; one of "parseInt",
 *		          	"SettingBox", "list"
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
//challengeTextToAbstract(s, template) {	//	use this prototype once integrated into CHALLENGE_DEFS
//	var desc = s.split("><");
challengeTextToAbstract(desc, template) {
	if (desc.length != template.length) throw new TypeError("found " + desc.length + " parameters, expected " + template.length);
	var params = { _error: {}, _templates: {} };
	for (var i = 0; i < template.length; i++) {
		params[template[i].param] = template[i].defaultval;
		params._error[template[i].param] = [];
		params._templates[template[i].param] = template[i];
		if (template[i].parse === "parseInt") {
			var tmp = parseInt(desc[i]);
			if (isNaN(tmp)) {
				params._error[template[i].param].push("not a number; using default");
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
		} else if (template[i].parse === "SettingBox") {
			var tmp = this.checkSettingBoxEx(desc[i], template[i].parseFmt);
			params[template[i].param] = tmp.value;
			params._error[template[i].param].splice(-1, 0, ...tmp.error);
		} else if (template[i].parse === "list") {
			var tmp = desc[i].split(template[i].separator);
			params[template[i].param] = [];
			tmp.forEach(s => {
				if (this.enumToValue(s, template[i].formatter) == 0)
					params._error[template[i].param].push(s + " not found in enum, ignoring");
				else
					params[template[i].param].push(s);
			});
			if (params[template[i].param].length < template[i].minval) {
				params[template[i].param] = [template[i].defaultval];
				params._error[template[i].param].push("count less than minimum; using default");
			}
		} else {
			console.log("unsupported parse operation: " + template[i].parse);
		}
	}
	return params;
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
	for (var i = 0; i < this.pluralReplacers.length; i++)
		s = s.replace(this.pluralReplacers[i].regex, this.pluralReplacers[i].text);
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
 *	Finds the given string, in BINARY_TO_STRING_DEFINITIONS[i].name,
 *	returning the first matching index i, or -1 if not found.
 */
challengeValue(s) {
	return this.BINARY_TO_STRING_DEFINITIONS.findIndex(a => a.name === s);
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
 *	Checks descriptor length against given value.  CHALLENGES helper function.
 *	@param t  (String) name of calling challenge
 *	@param d  (Number) desc.length
 *	@param g  (Number) expected length
 *	@throws TypeError on mismatch
 */
static checkDescLen(t, d, g) {
	if (d != g) throw new TypeError(t + ": found " + String(d) + " parameters, expected " + String(g));
}

/**
 *	Check if the specified challenge descriptor SettingBox string matches
 *	the asserted value.  Helper function for CHALLENGES functions.
 *	@param t    string, name of calling object/function
 *	@param d    string to parse and verify (e.g. "System.String|selectedItem|LabelText|itemIndex|list")
 *	@param f    array of values to compare to; length must match, empty elements are ignored
 *	@param err  string, text to include in the error
 *	@throws TypeError if invalid
 */
static checkSettingBox(t, d, f, err) {
	var items = d.split("|");
	if (items.length != f.length) throw new TypeError(t + ": " + err + ", found "
			+ String(items.length) + " items, expected: " + String(f.length));
	for (var i = 0; i < items.length; i++) {
		if (f[i] !== undefined && items[i] != f[i])
			throw new TypeError(t + ": " + err + ", found \"" + items[i] + "\", expected: \"" + String(f[i]) + "\"");
	}
	return items;
}

/**
 *	Extract region code from given room code string.
 *	All extant regions follow this pattern, so, probably safe enough?
 */
static regionOfRoom(r) {
	return r.substring(0, r.search("_"));
}

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
 *		  (and probably an error)
 *		- When a matching entry exists, it contains a list of steps to apply
 *		  to d to update it to a newer version.  This may be a subsequent
 *		  version, or directly to latest.  Just make sure there is no sequence
 *		  of update steps that would cause it to loop forever(!).
 *		- Expected structure:
 *		upg = {
 *			3: [ {
 *				//	d.splice(offs, rem, ...data)
 *				op: "splice", offs: 2, rem: 0, data: ["insert string 1", "insert string 2"]
 *			} ],
 *			5: [ {
 *				//	d.push(...data)
 *				op: "push", data: ["new last string"]
 *			} ],
 *			6: [ {
 *				//	d.unshift(...data)
 *				op: "unshift", data: ["new first string"]
 *			} ],
 *			7: [ {
 *				//	d[offs] = d[offs].replace(find, replace)
 *				op: "replace", offs: 4, find: "insert string", replace: "added text"
 *			} ]
 *		};
 *		Executing upg on d = ["foo", "bar", "baz"] gives the result:
 *		["new first string", "foo", "bar", "insert string 1", "added text 2", "baz", "new last string"]
 *	@return d is modified in place; it's also returned for convenience
 */
static upgradeDescriptor(d, upg) {
	var iterations = 0;
	do {
		var l = d.length;
		if (upg[l] === undefined) {
			break;
		} else {
			for (var i = 0; i < upg[l].length; i++) {
				var step = upg[l][i];
				if (step.op === "splice") {
					d.splice(step.offs, step.rem, ...step.data);
				} else if (step.op === "push") {
					d.push(step.data);
				} else if (step.op === "unshift") {
					d.unshift(step.data);
				} else if (step.op === "replace") {
					d[step.offs] = d[step.offs].replace(step.find, step.replace);
				} else if (step.op === "intFormat") {
					//	used by BingoAllRegionsExcept v0.85
					if (!isNaN(parseInt(d[step.offs])))
						d[step.offs] = step.before + String(parseInt(d[step.offs])) + step.after;
				} else {
					console.log(thisname + ": unsupported upgrade operation: " + upg[l][i].op);
				}
			}
		}
		iterations++;
	} while (d.length != l && iterations < 1000);
	if (iterations >= 1000) console.log("upgradeDescriptor(): infinite loop detected.");
	return d;
}


/*                                     *
/* * * Board Encoding and Decoding * * *
 *                                     */

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
 *				toBin: <Uint8Array>	//	binary format of goal
 *			},
 *			(...)
 *		],
 *		text: <string>,    	//	text format of whole board, including meta supported by current version
 *		toBin: <Uint8Array>	//	binary format of whole board, including meta and concatenated goals
 *		error: <string>     //	a text description of any errors that occurred on parsing
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
		toBin: undefined,
		text: s,
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

	for (var i = 0; i < goals.length; i++) {
		var type, desc;
		if (goals[i].search("~") > 0 && goals[i].search("><") > 0) {
			[type, desc] = goals[i].split("~");
			desc = desc.split(/></);
			if (type === "BingoMoonCloak") type = "BingoMoonCloakChallenge";	//	1.08 hack
			if (Bingovista.CHALLENGES[type] !== undefined) {
				try {
					this.board.goals.push(Bingovista.CHALLENGES[type].call(this, desc));
				} catch (er) {
					this.board.goals.push(Bingovista.CHALLENGES["BingoChallenge"].call(this, [
						"Error: " + er.message + "; descriptor: " + desc.join("><") ]));
				}
			} else {
				this.board.goals.push(Bingovista.CHALLENGES["BingoChallenge"].call(this, ["Error: unknown type: [" + type + "," + desc.join(",") + "]"], this.board));
			}
		} else {
			this.board.goals.push(Bingovista.CHALLENGES["BingoChallenge"].call(this, ["Error extracting goal: " + goals[i]], this.board));
		}
	}
	if (goals.length == 0)
		this.board.goals.push(Bingovista.CHALLENGES["BingoChallenge"].call(this, ["empty"], this.board));

	//	collect or re-set the binary format and we're done
	this.board.toBin = this.boardToBin();
}

/**
 *	Converts this.board to binary format.
 *	A header is created, then toBin snippets are concatenated together.
 *	board must be initialized, including metadata, and goals with valid
 *	toBin snippets.
 *	@return (Uint8Array) board in binary format
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
		gLen += this.board.goals[i].toBin.length;
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
		r.set(this.board.goals[i].toBin, offs); offs += this.board.goals[i].toBin.length;
	}

	return r;
}

/**
 *	Converts binary format to an abstract board object.
 */
binToBoard(a) {
	//	Minimum size to read full header
	if (a.length < HEADER_LENGTH)
		throw new TypeError("binToBoard: insufficient data, found " + String(a.length) + ", expected: " + String(HEADER_LENGTH) + " bytes");
	//	uint32_t magicNumber;
	if (Bingovista.readLong(a, 0) != 0x69427752)
		throw new TypeError("binToBoard: unknown magic number: 0x" + Bingovista.readLong(a, 0).toString(16) + ", expected: 0x69427752");
	//	(6, 7) uint8_t boardWidth; uint8_t boardHeight;
	this.board = {
		comments: "",
		character: "",
		perks: 0,
		shelter: "",
		size: a[6],	//	for now, width = height = size, so the source of this assignment doesn't matter
		width: a[6],
		height: a[7],
		text: "",
		goals: [],
		toBin: a,
		text: "",
		error: ""
	};
	var d = new TextDecoder;
	//	uint8_t version_major; uint8_t version_minor;
	if (((a[4] << 8) + a[5]) > (VERSION_MAJOR << 8) + VERSION_MINOR)
		this.board.error = "Warning: board version " + String(a[4]) + "." + String(a[5])
				+ " is newer than viewer v" + String(VERSION_MAJOR) + "." + String(VERSION_MINOR)
				+ "; some goals or features may be unsupported.";
	//	uint8_t character;
	this.board.text = (a[8] <= 0) ? "Any" : this.maps.characters[a[8] - 1].name;
	this.board.character = (a[8] <= 0) ? "Any" : this.maps.characters[a[8] - 1].text;
	this.board.text += ";";

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
	//	uint32_t perks;
	this.board.perks = Bingovista.readLong(a, 11);
	//	uint16_t reserved;
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
			goal = this.binGoalToText(sa);
		} catch (er) {
			goal = "BingoChallenge~Error: " + er.message + ", len " + sa.length + ", bytes [" + sa.join(",") + "]><";
		}
		goalOffs += GOAL_LENGTH + a[goalOffs + 2];
		[type, desc] = goal.split("~");
		desc = desc.split(/></);
		this.board.goals.push(Bingovista.CHALLENGES[type].call(this, desc));
		this.board.text += goal + "bChG";
	}
	this.board.text = this.board.text.replace(/bChG$/, "");
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
binGoalToText(c) {
	var s, p, j, k, outputs, stringtype, maxIdx, replacer, tmp;
	var d = new TextDecoder;

	if (c[0] >= this.BINARY_TO_STRING_DEFINITIONS.length)
		throw new TypeError("binGoalToText: unknown challenge type " + String(c[0]));
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
			if (p[j].signed && p[j].formatter == "" && outputs[0] >= (1 << (k * 8 - 1)))
				outputs[0] = outputs[0] - (1 << (k * 8));

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
				throw new TypeError("binGoalToText: formatter \"" + f + "\" not found");
			tmp = [];
			for (k = 0; k < outputs.length; k++) {
				if (p[j].altthreshold === undefined || outputs[k] < p[j].altthreshold) {
					if (this.enums[f][outputs[k] - 1] === undefined)
						throw new TypeError("binGoalToText: formatter \"" + f + "\", value out of range: " + String(outputs[k]));
					tmp.push(this.enums[f][outputs[k] - 1]);
				} else {
					if (this.enums[p[j].altformatter][outputs[k] - p[j].altthreshold] === undefined)
						throw new TypeError("binGoalToText: alternative formatter \"" + p[j].altformatter + "\", value out of range: " + String(outputs[k]));
					tmp.push(this.enums[p[j].altformatter][outputs[k] - p[j].altthreshold]);
				}
			}
			replacer = tmp.join(p[j].joiner || "");
		}
		s = s.replace(RegExp("\\{" + String(j) + "\\}", "g"), replacer);
	}
	s =
			(this.ChallengeUpgrades[this.BINARY_TO_STRING_DEFINITIONS[c[0]].name]
			|| this.BINARY_TO_STRING_DEFINITIONS[c[0]].name)
			+ "~" + s;
	return s;
}


/*                              *
 * * * Challenges Functions * * *
 *                              */

/* * * TODO: refactor block functions, into templates and outputter functions; * * *
 * * * integrate with BINARY_TO_STRING_DEFINITIONS; bring into class           * * */

/**
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
 *	etc.  See: ChallengeUpgrades and BINARY_TO_STRING_DEFINITIONS.
 *
 *	Maintain sync between CHALLENGES, BINARY_TO_STRING_DEFINITIONS and
 *	BingoEnum_CHALLENGES.
 *
 *	@param desc   list of goal parameters to parse (goal_text.split("><"))
 *	@return (collection of board info outputs)
 */
static CHALLENGES = {
	BingoChallenge: function(desc) {
		const thisname = "BingoChallenge";
		//	Keep as template and default; behavior is as a zero-terminated string container
		desc[0] = desc[0].substring(0, 255);
		var b = new Uint8Array(258);
		b[0] = this.challengeValue(thisname);
		var enc = new TextEncoder().encode(desc[0]);
		enc = enc.subarray(0, 255);
		b.set(enc, 3);
		b[2] = enc.length;
		return {
			name: thisname,
			category: "Empty challenge class",
			items: [],	/**< items and values arrays must have equal length */
			values: [],
			description: desc[0],	/**< HTML allowed for other goals (not this one) */
			comments: "",	/**< HTML allowed */
			paint: [
				{ type: "text", value: "∅", color: Bingovista.colors.Unity_white }
			],
			toBin: b.subarray(0, enc.length + GOAL_LENGTH)
		};
	},
	BingoAchievementChallenge: function(desc) {
		const thisname = "BingoAchievementChallenge";
		//	assert: desc of format ["System.String|Traveller|Passage|0|passage", "0", "0"]
		const upgrades = {};
		desc = Bingovista.upgradeDescriptor(desc, upgrades);
		const template = [
			{ param: "passage",  type: "string", formatter: "passage", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Passage", position: "0", formatter: "passage", altformatter: "", altthreshold: 0, defaultval: "Traveller" } },
			{ param: "completed", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "revealed",  type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 }
		];
		var params = this.challengeTextToAbstract(desc, template);
		params._name = thisname;
		function AchievementChallengePaint(p) {
			return [
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.maps.passage.find(o => o.name === p.passage).icon, scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
			];
		}
		function AchievementChallengeDescription(p) {
			return "Earn " + (this.maps.passage.find(o => o.name === p.passage).text || "unknown") + " passage.";
		}
		function AchievementChallengeComment(p) {
			return "";
		}
		function AchievementChallengeToBinary(p) {
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.passage, "passage");
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
		return {
			name: thisname,
			params: params,
			category: "Obtaining Passages",
			items: ["passage"],
			values: [params.passage],
			description: AchievementChallengeDescription.call(this, params),
			comments: AchievementChallengeComment.call(this, params),
			paint: AchievementChallengePaint.call(this, params),
			toBin: AchievementChallengeToBinary.call(this, params)
		};
	},
	BingoAllRegionsExcept: function(desc) {
		const thisname = "BingoAllRegionsExcept";
		//	desc of format ["System.String|UW|Region|0|regionsreal", "SU|HI|DS|CC|GW|SH|VS|LM|SI|LF|UW|SS|SB|LC", "0", "System.Int32|13|Amount|1|NULL", "0", "0"]
		const upgrades = {
			6: [ { op: "intFormat", offs: 3, before: "System.Int32|", after: "|Amount|1|NULL" } ]
		};
		const template = [
			{ param: "region",  type: "string", formatter: "regions", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Region", position: "0", formatter: "regionsreal", defaultval: "SU" } },
			{ param: "remaining", type: "array", formatter: "regionsreal", parse: "list", separator: "|", defaultval: [] },
			{ param: "current", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "amount",  type: "number", formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Int32", name: "Amount", position: "1", formatter: "NULL", minval: 0, maxval: INT_MAX, defaultval: 1 } },
			{ param: "completed", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "revealed",  type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 }
		];
		var params = this.challengeTextToAbstract(desc, template);
		params._name = thisname;;
		function AllRegionsExceptToPaint(p) {
			return [
				{ type: "icon", value: "TravellerA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
				{ type: "text", value: p.region, color: Bingovista.colors.Unity_white },
				{ type: "break" },
				{ type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white }
			];
		}
		function AllRegionsExceptToDescription(p) {
			return "Enter " + (((p.amount - p.current) > 1) ? String(p.amount - p.current) + " more regions" : (((p.amount - p.current) > 0) ? "one more region" : "no more regions") ) + " without entering " + this.regionToDisplayText(this.board.character, p.region) + ".";
		}
		function AllRegionsExceptToComment(p) {
			return "This challenge is potentially quite customizable; only regions in the list need to be entered. Normally, the list is populated with all campaign story regions (i.e. corresponding Wanderer pips), so that progress can be checked on the sheltering screen. All that matters towards completion, is Progress equaling Total; thus we can set a lower bar and play a \"The Wanderer\"-lite; or we could set a specific collection of regions to enter, to entice players towards them. Downside: the latter functionality is not currently supported in-game: the region list is something of a mystery unless viewed and manually tracked. (This goal generates with all regions listed, so that all will contribute towards the goal.)";
		}
		function AllRegionsExceptToBinary(p) {
			var b = Array(5); b.fill(0);
			b[0] = this.challengeValue(p._name);
			b[3] = this.enumToValue(p.region, "regionsreal");
			b[4] = Math.max(0, Math.min(p.required - p.current, CHAR_MAX));
			p.remaining.forEach(s => b.push(this.enumToValue(s, "regionsreal")) );
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
		var v = [], i = [];
		v.push(String(params.region));    i.push("region");
		v.push(params.remaining.join(params._templates.remaining.separator)); i.push("remaining");
		v.push(String(params.current));   i.push("current");
		v.push(String(params.amount));    i.push("amount");
		return {
			name: thisname,
			params: params,
			category: "Entering regions while never visiting one",
			items: i,
			values: v,
			description: AllRegionsExceptToDescription.call(this, params),
			comments: AllRegionsExceptToComment.call(this, params),
			paint: AllRegionsExceptToPaint.call(this, params),
			toBin: AllRegionsExceptToBinary.call(this, params)
		};
	},
	BingoBombTollChallenge: function(desc) {
		const thisname = "BingoBombTollChallenge";
		//	desc of format (< v1.2) ["System.String|gw_c05|Scavenger Toll|1|tolls", "System.Boolean|false|Pass the Toll|0|NULL", "0", "0"]
		//	or (>= 1.2) ["System.Boolean|true|Specific toll|0|NULL", "System.String|gw_c05|Scavenger Toll|3|tolls", "System.Boolean|false|Pass the Toll|2|NULL", "0", "System.Int32|3|Amount|1|NULL", "empty", "0", "0"]
		const upgrades = {
			4: [	//	< v1.2
				{ op: "splice", offs: 2, rem: 0, data: ["0", "System.Int32|3|Amount|1|NULL", "empty"] },
				{ op: "unshift", data: "System.Boolean|true|Specific toll|0|NULL" }
			]
		};
		desc = Bingovista.upgradeDescriptor(desc, upgrades);
		const template = [
			{ param: "specific",  type: "bool",   formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Boolean", name: "Specific toll", position: "0", formatter: "NULL", defaultval: false } },
			{ param: "roomName",  type: "string", formatter: "tolls", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Scavenger Toll", position: "3", formatter: "tolls", altformatter: "", altthreshold: 0, defaultval: "su_c02" } },
			{ param: "pass",      type: "bool",   formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Boolean", name: "Pass the Toll", position: "2", formatter: "NULL", defaultval: false } },
			{ param: "current",   type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: CHAR_MAX, defaultval: 0 },
			{ param: "amount",    type: "number", formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Int32", name: "Amount", position: "1", formatter: "NULL", minval: 0, maxval: CHAR_MAX, defaultval: 1 } },
			{ param: "bombed",    type: "list",   formatter: "tolls_bombed", parse: "list", separator: "%", minval: 1, defaultval: "empty" },
			{ param: "completed", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "revealed",  type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 }
		];
		var params = this.challengeTextToAbstract(desc, template);
		params._name = thisname;
		function BombTollChallengeToPaint(p) {
			var r = [
				{ type: "icon", value: "Symbol_StunBomb", scale: 1, color: this.entityIconColor("ScavengerBomb"), rotation: 0 },
				{ type: "icon", value: "scavtoll", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: p.specific ? p.roomName.toUpperCase() : ("[" + String(p.current) + "/" + String(p.amount) + "]"), color: Bingovista.colors.Unity_white }
			];
			if (p.pass)
				r.splice(2, 0, { type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			return r;
		}
		function BombTollChallengeToComments(p) {
			return "A hit is registered within a 500-unit radius of the toll. Bomb and pass can be done in either order within a cycle; or even bombed in a previous cycle, then passed later.<br>" +
				"When the <span class=\"code\">specific</span> flag is set, <span class=\"code\">amount</span> and <span class=\"code\">current</span> are unused; when cleared, <span class=\"code\">Scavenger Toll</span> is unused.<br>" +
				"The <span class=\"code\">bombed</span> list records the state of the multi-toll version. It's a dictionary of the form: <span class=\"code\">{room name}|{false/true}[%...]</span>, where the braces are replaced with the respective values, and <span class=\"code\">|</span> and <span class=\"code\">%</span> are literal, and (\"...\") indicates subsequent key-value pairs; or <span class=\"code\">empty</span> when empty. (Room names are case-sensitive, matching the game-internal naming.)  A room is added to the list when bombed, with a Boolean value of <span class=\"code\">false</span> before passing, or <span class=\"code\">true</span> after. By preloading this list, a customized \"all but these tolls\" challenge could be crafted (but, do note the list does not show in-game!).";
		}
		function BombTollChallengeToDescription(p) {
			var d;
			if (p.specific) {
				var regi = Bingovista.regionOfRoom(p.roomName).toUpperCase();
				if (this.enums.regions.indexOf(regi) < 0)
					throw new TypeError(thisname + ": region \"" + regi + "\" not found in regions");
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
		}
		function BombTollChallengeToBinary(p) {
			var b = Array(4); b.fill(0);
			if (p.specific === "true") {
				//	can use old version
				b[0] = this.challengeValue("BingoBombTollChallenge");
				Bingovista.applyBool(b, 1, 4, p.pass);
				b[3] = this.enumToValue(p.roomName, "tolls");
				b[2] = b.length - GOAL_LENGTH;
			} else {
				//	new format
				b = Array(5); b.fill(0);
				b[0] = this.challengeValue("BingoBombTollExChallenge");
				Bingovista.applyBool(b, 1, 4, p.pass);
				Bingovista.applyBool(b, 1, 5, p.specific);
				b[3] = this.enumToValue(p.roomName, "tolls");
				b[4] = p.amount;
				for (var k = 0; k < p.bombed.length; k++) {
					b.push(this.enums.tolls_bombed.indexOf(p.bombed[k]));
				}
				b[2] = b.length - GOAL_LENGTH;
			}
			return new Uint8Array(b);
		}
		var v = [], i = [];
		v.push(String(params.specific)); i.push("specific");
		v.push(String(params.roomName)); i.push("roomName");
		v.push(String(params.pass));     i.push("pass");
		v.push(String(params.current));  i.push("current");
		v.push(String(params.amount));   i.push("amount");
		v.push(String(params.bombed.join(params._templates.bombed.separator))); i.push("bombed");
		return {
			name: thisname,
			params: params,
			category: "Throwing grenades at Scavenger tolls",
			items: i,
			values: v,
			description: BombTollChallengeToDescription.call(this, params),
			comments: BombTollChallengeToComments.call(this, params),
			paint: BombTollChallengeToPaint.call(this, params),
			toBin: BombTollChallengeToBinary.call(this, params)
		};
	},
	BingoCollectPearlChallenge: function(desc) {
		const thisname = "BingoCollectPearlChallenge";
		//	desc of format ["System.Boolean|true|Specific Pearl|0|NULL", "System.String|LF_bottom|Pearl|1|pearls", "0", "System.Int32|1|Amount|3|NULL", "0", "0", ""]
		Bingovista.checkDescLen(thisname, desc.length, 7);
		var speci = Bingovista.checkSettingBox(thisname, desc[0], ["System.Boolean", , "Specific Pearl", , "NULL"], "specific pearl flag");
		if (speci[1] !== "true" && speci[1] !== "false")
			throw new TypeError(thisname + ": starving flag \"" + speci[1] + "\" not 'true' or 'false'");
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.String", , "Pearl", , "pearls"], "pearl selection");
		if (this.enums.pearls.findIndex(s => s === items[1]) < 0) {
			throw new TypeError(thisname + ": item \"" + items[1] + "\" not found in pearls");
		}
		var amounts = Bingovista.checkSettingBox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var d, p;
		if (speci[1] === "true") {
			var r = "";
			if (items[1] === "MS")
				r = "Old " + ["GW"];
			else {
				var regi = this.maps.pearls.find(o => o.name === items[1]).region;
				if (regi === undefined)
					throw new TypeError(thisname + ": item \"" + items[1] + "\" not found in pearls");
				if (items[1] === "DM") {
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
			d = "Collect the " + this.maps.pearls.find(o => o.name === items[1]).text + " pearl from " + r + ".";
			p = [
				{ type: "text", value: items[1], color: Bingovista.colors.Unity_white },
				{ type: "break" },
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: this.maps.pearls.find(o => o.name === items[1]).color, rotation: 0, background:
					{ type: "icon", value: "radialgradient", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
				},
				{ type: "break" },
				{ type: "text", value: "[0/1]", color: Bingovista.colors.Unity_white }
			];
		} else {
			d = "Collect " + this.entityNameQuantify(amt, "colored pearls") + ".";
			p = [
				{ type: "icon", value: "pearlhoard_color", scale: 1, color: this.entityIconColor("Pearl"), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			];
		}
		var b = Array(6); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyBool(b, 1, 4, speci[1] === "true");
		b[3] = this.enumToValue(items[1], "pearls");
		Bingovista.applyShort(b, 4, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Collecting pearls",
			items: [speci[2], items[2], amounts[2]],
			values: [speci[1], items[1], amounts[1]],
			description: d,
			comments: "When collecting multiple pearls, this challenge acts like a flexible The Scholar passage. When collecting single pearls, the amount is unused; when collecting multiple, the location is unused.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoCraftChallenge: function(desc) {
		const thisname = "BingoCraftChallenge";
		//	desc of format ["System.String|JellyFish|Item to Craft|0|craft", "System.Int32|5|Amount|1|NULL", "0", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 5);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Item to Craft", , "craft"], "item selection");
		if (!this.enums.craft.includes(items[1])) {
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in craft");
		}
		var d = this.entityDisplayText(items[1]);
		var amounts = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var b = Array(6); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(items[1], "craft");
		Bingovista.applyShort(b, 4, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Crafting items",
			items: [items[2], amounts[2]],
			values: [items[1], amounts[1]],
			description: "Craft " + this.entityNameQuantify(amt, d) + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "crafticon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.entityIconAtlas(items[1]), scale: 1, color: this.entityIconColor(items[1]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoCreatureGateChallenge: function(desc) {
		const thisname = "BingoCreatureGateChallenge";
		//	desc of format ["System.String|CicadaA|Creature Type|1|transport", "0", "System.Int32|4|Amount|0|NULL", "empty", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 6);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Creature Type", , "transport"], "creature selection");
		if (this.enums.creatures.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in creatures");
		var amounts = Bingovista.checkSettingBox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		if (this.enums.transport.includes(items[1]))
			b[3] = this.enumToValue(items[1], "transport");
		else
			b[3] = this.enumToValue(items[1], "creatures") + this.BINARY_TO_STRING_DEFINITIONS[this.challengeValue(thisname)].params[0].altthreshold - 1;
		b[4] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Transporting the same creature through gates",
			items: [items[2], amounts[2], "Dictionary"],
			values: [items[1], amounts[1], desc[3]],
			description: "Transport " + this.entityNameQuantify(1, this.entityDisplayText(items[1])) + " through " + String(amt) + " gate" + ((amt > 1) ? "s." : "."),
			comments: "When a creature is taken through a gate, that creature is added to a list and the gate is logged. If a gate already appears in the creature's list, taking that gate again will not advance the count. Thus, you can't grind progress by taking one gate back and forth. The list is stored per creature transported; thus, taking a new different creature does not advance the count, nor does piling multiple creatures into one gate. When the total gate count of any logged creature reaches the goal, credit is awarded.",
			paint: [
				{ type: "icon", value: this.entityIconAtlas(items[1]), scale: 1, color: this.entityIconColor(items[1]), rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "ShortcutGate", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoCycleScoreChallenge: function(desc) {
		const thisname = "BingoCycleScoreChallenge";
		//	desc of format ["System.Int32|126|Target Score|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.Int32", , "Target Score", , "NULL"], "score goal");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Scoring cycle points",
			items: [items[2]],
			values: [String(amt)],
			description: "Earn " + String(amt) + " points from creature kills in a single cycle.",
			comments: "",
			paint: [
				{ type: "icon", value: "Multiplayer_Star", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDamageChallenge: function(desc) {
		const thisname = "BingoDamageChallenge";
		//	desc of format (< v1.091) ["System.String|JellyFish|Weapon|0|weapons", "System.String|WhiteLizard|Creature Type|1|creatures", "0", "System.Int32|6|Amount|2|NULL", "0", "0"]
		//	or (>= v1.091) ["System.String|JellyFish|Weapon|0|weapons", "System.String|AquaCenti|Creature Type|1|creatures", "0", "System.Int32|5|Amount|2|NULL", "System.Boolean|false|In One Cycle|0|NULL", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions", "0", "0"]
		//	or (>= v1.2) ["System.String|JellyFish|Weapon|0|weapons", "System.String|PinkLizard|Creature Type|1|creatures", "0", "System.Int32|3|Amount|2|NULL", "System.Boolean|false|In One Cycle|3|NULL", "System.String|Any Region|Region|5|regions", "0", "0"]
		const upgrades = {
			6: [ {	//	v1.091 hack: allow 6 or 9 parameters; assume the existing parameters are ordered as expected
				op: "splice", offs: 4, rem: 0, data: ["System.Boolean|false|In One Cycle|0|NULL", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|5|subregions"]
			} ],
			8: [ {	//	>= v1.2: Subregion removed; add back in dummy value for compatibility
				op: "splice", offs: 6, rem: 0, data: ["System.String|Any Subregion|Subregion|5|subregions"]
			} ],
			9: [ {	//	Bingovista-native format; one typo cleanup, then return the .length = 9
				op: "replace", offs: 6, find: "Journey\\'s End", replace: "Journey's End"
			} ]
		};
		desc = Bingovista.upgradeDescriptor(desc, upgrades);
		const template = [
			{ param: "weapon",  type: "string", formatter: "weapons", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Weapon", position: "0", formatter: "weapons", altformatter: "", altthreshold: 0, defaultval: "Any Weapon" } },
			{ param: "victim",  type: "string", formatter: "creatures", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Creature Type", position: "1", formatter: "creatures", altformatter: "", altthreshold: 0, defaultval: "Any Creature" } },
			{ param: "current", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "amount",  type: "number", formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Int32", name: "Amount", position: "2", formatter: "NULL", minval: 0, maxval: INT_MAX, defaultval: 1 } },
			{ param: "onecycle",  type: "bool", formatter: "", parse: "SettingBox", parseFmt: { datatype: "System.Boolean", name: "In One Cycle", position: "3", formatter: "NULL", defaultval: false } },
			{ param: "region",  type: "string", formatter: "regions", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Region", position: "5", formatter: "regions", defaultval: "Any Region" } },
			{ param: "subregion",  type: "string", formatter: "subregions", parse: "SettingBox", parseFmt: { datatype: "System.String", name: "Subregion", position: "4", formatter: "subregions", defaultval: "Any Subregion" } },
			{ param: "completed", type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 },
			{ param: "revealed",  type: "number", formatter: "", parse: "parseInt", minval: 0, maxval: INT_MAX, defaultval: 0 }
		];
		var params = this.challengeTextToAbstract(desc, template);
		params._name = thisname;
		function DamageChallengePaint(p) {
			var r = [];
			if (p.weapon !== "Any Weapon") {
				r.push( { type: "icon", value: this.entityIconAtlas(p.weapon), scale: 1, color: this.entityIconColor(p.weapon), rotation: 0 } );
			}
			r.push( { type: "icon", value: "bingoimpact", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			if (p.victim !== "Any Creature") {
				r.push( { type: "icon", value: this.entityIconAtlas(p.victim), scale: 1, color: this.entityIconColor(p.victim), rotation: 0 } );
			}
			if (p.subregion === "Any Subregion") {
				if (p.region !== "Any Region") {
					r.push( { type: "break" } );
					r.push( { type: "text", value: p.region, color: Bingovista.colors.Unity_white } );
				}
			} else {
				r.push( { type: "break" } );
				r.push( { type: "text", value: p.subregion, color: Bingovista.colors.Unity_white } );
			}
			r.push( { type: "break" } );
			r.push( { type: "text", value: "[" + String(p.current) + "/" + String(p.amount) + "]", color: Bingovista.colors.Unity_white } );
			if (p.onecycle)
				r.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			return r;
		}
		function DamageChallengeDescription(p) {
			var r = this.regionToDisplayText(this.board.character, p.region, p.subregion);
			if (r > "") r = ", in " + r;
			var d = "Hit " + this.entityDisplayText(p.victim) + " with " + this.entityDisplayText(p.weapon);
			d += " " + String(p.amount) + ((p.amount > 1) ? " times" : " time") + r;
			if (p.onecycle) d += ", in one cycle";
			d += ".";
			return d;
		}
		function DamageChallengeComments(p) {
			return "Note: the reskinned BLLs in the Past Garbage Wastes tunnel <em>do not count</em> as DLLs for this challenge.<br>" +
					"Note: <span class=\"code\">Subregion</span> was never fully implemented, and is deprecated in v1.2+. Bingovista displays this parameter only for completeness.";
		}
		function DamageChallengeToBinary(p) {
			//	start with classic format...
			var b = Array(7); b.fill(0);
			b[0] = this.challengeValue(thisname);
			b[3] = this.enumToValue(p.weapon, "weapons");
			b[4] = this.enumToValue(p.victim, "creatures");
			Bingovista.applyShort(b, 5, p.amount);
			if (p.onecycle || p.region !== "Any Region" || p.subregion !== "Any Subregion") {
				//	...have to use expanded form
				b[0] = this.challengeValue("BingoDamageExChallenge");
				Bingovista.applyBool(b, 1, 4, p.onecycle);
				b.push(this.enumToValue(p.region, "regions"));
				b.push(this.enumToValue(p.subregion, "subregions"));
			}
			b[2] = b.length - GOAL_LENGTH;
			return new Uint8Array(b);
		}
		var v = [], i = [];
		v.push(String(params.weapon));    i.push("weapon");
		v.push(String(params.victim));    i.push("victim");
		v.push(String(params.current));   i.push("current");
		v.push(String(params.amount));    i.push("amount");
		v.push(String(params.onecycle));  i.push("onecycle");
		v.push(String(params.region));    i.push("region");
		v.push(String(params.subregion)); i.push("subregion");
		return {
			name: thisname,
			params: params,
			category: "Hitting creatures with items",
			items: i,
			values: v,
			description: DamageChallengeDescription.call(this, params),
			comments: DamageChallengeComments.call(this, params),
			paint: DamageChallengePaint.call(this, params),
			toBin: DamageChallengeToBinary.call(this, params)
		};
	},
	BingoDepthsChallenge: function(desc) {
		const thisname = "BingoDepthsChallenge";
		//	desc of format ["System.String|VultureGrub|Creature Type|0|depths", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Creature Type", , "depths"], "creature selection");
		if (this.enums.depths.indexOf(items[1]) < 0 && this.enums.creatures.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in creatures");
		var d = this.entityNameQuantify(1, this.entityDisplayText(items[1]));
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		if (this.enums.transport.includes(items[1]))
			b[3] = this.enumToValue(items[1], "depths");
		else
			b[3] = this.enumToValue(items[1], "creatures") + this.BINARY_TO_STRING_DEFINITIONS[this.challengeValue(thisname)].params[0].altthreshold - 1;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dropping a creature in the depth pit",
			items: [items[2]],
			values: [items[1]],
			description: "Drop " + d + " into the Depths drop room (" + this.getMapLink("SB_D06", this.board.character) + ").",
			comments: "Player, and creature of target type, must be in the room at the same time, and the creature's position must be below the drop.",
			paint: [
				{ type: "icon", value: this.entityIconAtlas(items[1]), scale: 1, color: this.entityIconColor(items[1]), rotation: 0 },
				{ type: "icon", value: "deathpiticon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "SB_D06", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDodgeLeviathanChallenge: function(desc) {
		const thisname = "BingoDodgeLeviathanChallenge";
		//	desc of format ["0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 2);
		var b = Array(3); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dodging a Leviathan",
			items: [],
			values: [],
			description: "Dodge a Leviathan's bite.",
			comments: "Being in close proximity to a Leviathan, as it's winding up a bite, will activate this goal. (A more direct/literal interpretation&mdash;having to have been physically inside its maw, then surviving after it slams shut&mdash;was found... too challenging by playtesters.)",
			paint: [
				{ type: "icon", value: "leviathan_dodge", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDontUseItemChallenge: function(desc) {
		const thisname = "BingoDontUseItemChallenge";
		//	desc of format ["System.String|BubbleGrass|Item type|0|banitem", "0", "0", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 5);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Item type", , "banitem"], "item selection");
		if (!this.enums.banitem.includes(items[1])) {
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in banitem");
		}
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyBool(b, 1, 4, desc[1] === "1");
		Bingovista.applyBool(b, 1, 5, desc[4] === "1");
		b[3] = this.enumToValue(items[1], "banitem");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding items",
			items: [items[2], "isFood", "isCreature"],
			values: [items[2], desc[1] === "1", desc[4] === "1"],
			description: "Never " + ((desc[1] === "1") ? "eat" : "use") + " " + this.entityDisplayText(items[1]) + ".",
			comments: "\"Using\" an item involves throwing a throwable item, eating a food item, or holding any other type of item for 5 seconds. (When sheltering with insufficient food pips (currently eaten), food items in the shelter are consumed automatically. Auto-eating on shelter <em>will not</em> count against this goal!)",
			paint: [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
				{ type: "icon", value: this.entityIconAtlas(items[1]), scale: 1, color: this.entityIconColor(items[1]), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoEatChallenge: function(desc) {
		const thisname = "BingoEatChallenge";
		//	desc of format (< v1.2) ["System.Int32|6|Amount|1|NULL", "0", "0", "System.String|DangleFruit|Food type|0|food", "0", "0"]
		//	or (>= v1.2) ["System.Int32|4|Amount|3|NULL", "0", "0", "System.String|SlimeMold|Food type|0|food", "System.Boolean|false|While Starving|2|NULL", "0", "0"]
		if (desc.length == 6) {
			desc.splice(4, 0, "System.Boolean|false|While Starving|2|NULL");
		}
		Bingovista.checkDescLen(thisname, desc.length, 7);
		var amounts = Bingovista.checkSettingBox(thisname, desc[0], ["System.Int32", , "Amount", , "NULL"], "eat amount");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var isCrit = parseInt(desc[2]);
		if (isNaN(isCrit) || isCrit < 0 || isCrit > 1)
			throw new TypeError(thisname + ": isCreature \"" + desc[2] + "\" not a number or out of range");
		isCrit = (isCrit == 1) ? "true" : "false";
		var items = Bingovista.checkSettingBox(thisname, desc[3], ["System.String", , "Food type", , "food"], "eat type");
		if (!this.enums.food.includes(items[1]))
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in food");
		var starv = Bingovista.checkSettingBox(thisname, desc[4], ["System.Boolean", , "While Starving", , "NULL"], "starving flag");
		if (starv[1] !== "true" && starv[1] !== "false")
			throw new TypeError(thisname + ": flag \"" + starv[1] + "\" not 'true' or 'false'");
		var p = [
			{ type: "icon", value: "foodSymbol", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
			{ type: "icon", value: this.entityIconAtlas(items[1]), scale: 1, color: this.entityIconColor(items[1]), rotation: 0 },
			{ type: "break" },
			{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
		];
		if (starv[1] === "true")
			p.splice(2, 0, { type: "break" }, { type: "icon", value: "Multiplayer_Death", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		var b = Array(6); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		Bingovista.applyBool(b, 1, 4, desc[2] === "1");
		Bingovista.applyBool(b, 1, 5, starv[1] === "true");
		b[5] = this.enumToValue(items[1], "food");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Eating specific food",
			items: [amounts[2], "isCreature", items[2], starv[2]],
			values: [String(amt), isCrit, items[1], starv[1]],
			description: "Eat " + this.entityNameQuantify(amt, this.entityDisplayText(items[1])) + ((starv[1] === "true") ? ", while starving." : "."),
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoEchoChallenge: function(desc) {
		const thisname = "BingoEchoChallenge";
		//	desc of format (< v1.2) ["System.String|SB|Region|0|echoes", "System.Boolean|false|While Starving|1|NULL", "0", "0"]
		//	or (>= v1.2) ["System.Boolean|false|Specific Echo|0|NULL", "System.String|SB|Region|1|echoes", "System.Boolean|true|While Starving|3|NULL", "0", "System.Int32|2|Amount|2|NULL", "0", "0", ""]
		if (desc.length == 4) {
			desc.unshift("System.Boolean|true|Specific Echo|0|NULL");
			desc.splice(3, 0, "0", "System.Int32|1|Amount|2|NULL");
			desc.push("");
		}
		Bingovista.checkDescLen(thisname, desc.length, 8);
		var speci = Bingovista.checkSettingBox(thisname, desc[0], ["System.Boolean", , "Specific Echo", , "NULL"], "specific flag");
		if (speci[1] !== "true" && speci[1] !== "false")
			throw new TypeError(thisname + ": specific flag \"" + speci[1] + "\" not 'true' or 'false'");
		var echor = Bingovista.checkSettingBox(thisname, desc[1], ["System.String", , "Region", , "echoes"], "echo region");
		if (this.enums.regions.indexOf(echor[1]) < 0)
			throw new TypeError(thisname + ": \"" + echor[1] + "\" not found in regions");
		var r = this.regionToDisplayText(this.board.character, echor[1]);
		var starv = Bingovista.checkSettingBox(thisname, desc[2], ["System.Boolean", , "While Starving", , "NULL"], "starving flag");
		if (starv[1] !== "true" && starv[1] !== "false")
			throw new TypeError(thisname + ": starving flag \"" + starv[1] + "\" not 'true' or 'false'");
		var amount = Bingovista.checkSettingBox(thisname, desc[4], ["System.Int32", , "Amount", , "NULL"], "echo amount");
		var amt = parseInt(amount[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + amount[1] + "\" not a number or out of range");
		var visited = [];
		if (desc[7] > "") {
			visited = desc[7].split("|");
			for (var k = 0; k < visited.length; k++) {
				if (this.enums.regions.indexOf(visited[k]) < 0)
					throw new TypeError(thisname + ": visited \"" + visited[k] + "\" not found in regions");
			}
		}
		var p = [
			{ type: "icon", value: "echo_icon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
			{ type: "text", value: ((speci[1] === "true") ? echor[1] : "[0/" + amt + "]"), color: Bingovista.colors.Unity_white }
		];
		if (starv[1] === "true") {
			p.push( { type: "break" } );
			p.push( { type: "icon", value: "Multiplayer_Death", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		}
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyBool(b, 1, 4, starv[1] === "true");
		b[3] = this.enumToValue(echor[1], "echoes");
		b[2] = b.length - GOAL_LENGTH;
		if (speci[1] === "false") {
			b[0] = this.challengeValue("BingoEchoExChallenge");
			b.push(amt);
			visited.forEach(v => b.push(this.enumToValue(v, "regions")));
		}
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Visiting echoes",
			items: [speci[2], echor[2], starv[2], amount[2], "visited"],
			values: [speci[1], echor[1], starv[1], String(amt), desc[7]],
			description: "Visit " + ((speci[1] === "false") ? (String(amt) + " Echoes") : ("the " + r + " Echo")) + ((starv[1] === "true") ? ", while starving." : "."),
			comments: "The \"visited\" list records the state of the multi-echo version. It is a <span class=\"code\">|</span>-separated list of region codes. A region is added to the list when its echo has been visited. By preloading this list, a customized \"all but these echoes\" challenge could be crafted (but, do note the list does not show in-game!).",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoEnterRegionChallenge: function(desc) {
		const thisname = "BingoEnterRegionChallenge";
		//	desc of format ["System.String|CC|Region|0|regionsreal", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "enter region");
		if (this.enums.regions.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": region \"" + items[1] + "\" not found in regions");
		var r = this.regionToDisplayText(this.board.character, items[1]);
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(items[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Entering a region",
			items: [items[2]],
			values: [items[1]],
			description: "Enter " + r + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.Unity_green, rotation: 90 },
				{ type: "text", value: items[1], color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoGlobalScoreChallenge: function(desc) {
		const thisname = "BingoGlobalScoreChallenge";
		//	desc of format ["0", "System.Int32|271|Target Score|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Target Score", , "NULL"], "score goal");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Scoring global points",
			items: [items[2]],
			values: [String(amt)],
			description: "Earn " + amt + " points from creature kills.",
			comments: "",
			paint: [
				{ type: "icon", value: "Multiplayer_Star", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoGreenNeuronChallenge: function(desc) {
		const thisname = "BingoGreenNeuronChallenge";
		//	desc of format ["System.Boolean|true|Looks to the Moon|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.Boolean", , "Looks to the Moon", , "NULL"], "iterator choice flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": flag \"" + items[1] + "\" not 'true' or 'false'");
		var d = "Deliver the green neuron to ";
		if (items[1] === "true") d = "Reactivate ";
		d += this.maps.iterators.find(o => o.name === items[1]).text + ".";
		var p = [
			{ type: "icon", value: "GuidanceNeuron", scale: 1, color: Bingovista.colors.GuidanceNeuron, rotation: 0 },
			{ type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
		]
		p.push( { type: "icon", value: this.maps.iterators.find(o => o.name === items[1]).icon, scale: 1, color: this.maps.iterators.find(o => o.name === items[1]).color, rotation: 0 } );
		var b = Array(3); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyBool(b, 1, 4, items[1] === "true");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering the Green Neuron",
			items: [items[2]],
			values: [items[1]],
			description: d,
			comments: "The green neuron only has to enter the screen the iterator is on and start the cutscene; waiting for full dialog/startup is not required for credit.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoHatchNoodleChallenge: function(desc) {
		const thisname = "BingoHatchNoodleChallenge";
		//	desc of format ["0", "System.Int32|3|Amount|1|NULL", "System.Boolean|true|At Once|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 5);
		var amounts = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "egg count");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var items = Bingovista.checkSettingBox(thisname, desc[2], ["System.Boolean", , "At Once", , "NULL"], "one-cycle flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [
			{ type: "icon", value: this.entityIconAtlas("NeedleEgg"), scale: 1, color: this.entityIconColor("NeedleEgg"), rotation: 0 },
			{ type: "icon", value: this.entityIconAtlas("SmallNeedleWorm"), scale: 1, color: this.entityIconColor("SmallNeedleWorm"), rotation: 0 },
			{ type: "break" },
			{ type: "text", value: "[0/" + amt + "]", color: Bingovista.colors.Unity_white },
		];
		if (items[1] === "true")
			p.splice(2, 0, { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = amt;
		Bingovista.applyBool(b, 1, 4, items[1] === "true");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hatching noodlefly eggs",
			items: [amounts[2], items[2]],
			values: [amounts[1], items[1]],
			description: "Hatch " + this.entityNameQuantify(amt, this.entityDisplayText("NeedleEgg")) + ((items[1] === "true") ? " in one cycle." : "."),
			comments: "Eggs must be hatched where the player is sheltering. Eggs stored in other shelters disappear and do not give credit towards this goal.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoHellChallenge: function(desc) {
		const thisname = "BingoHellChallenge";
		//	desc of format ["0", "System.Int32|2|Amount|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "goal count");
		var amt = parseInt(items[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Not dying before completing challenges",
			items: [items[2]],
			values: [String(amt)],
			description: "Do not die before completing " + this.entityNameQuantify(amt, "bingo challenges") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "completechallenge", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "text", value: "[0/" + amt + "]", color: Bingovista.colors.Unity_white },
				{ type: "break" },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
				{ type: "icon", value: "Multiplayer_Death", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoItemHoardChallenge: function(desc) {
		const thisname = "BingoItemHoardChallenge";
		//	desc of format (< v1.092) ["System.Int32|5|Amount|1|NULL", "System.String|PuffBall|Item|0|expobject", "0", "0"]
		//	or (>= 1.092) ["System.Boolean|true|Any Shelter|2|NULL", "0", "System.Int32|4|Amount|0|NULL", "System.String|DangleFruit|Item|1|expobject", "0", "0", ""]
		//	or (>= 1.2) ["System.Boolean|true|Any Shelter|2|NULL", "0", "System.Int32|4|Amount|0|NULL", "System.String|Mushroom|Item|1|expobject", "System.String|VS|Region|4|regions", "0", "0", ""]
		//	anyShelter, current, amount, item, region, completed, revealed, collected
		if (desc.length == 4) {
			//	1.092 hack: allow 4 or 7 parameters; assume the existing parameters are ordered as expected
			desc.unshift("System.Boolean|false|Any Shelter|2|NULL", "0");
			desc.push("");
		}
		if (desc.length == 7) {
			//	1.2 hack: allow 4, 7 or 8 parameters
			desc.splice(4, 0, "System.String|Any Region|Region|4|regions");
		}
		Bingovista.checkDescLen(thisname, desc.length, 8);
		var any = Bingovista.checkSettingBox(thisname, desc[0], ["System.Boolean", , "Any Shelter", , "NULL"], "any shelter flag");
		var amounts = Bingovista.checkSettingBox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "item count");
		var items = Bingovista.checkSettingBox(thisname, desc[3], ["System.String", , "Item", , "expobject"], "item selection");
		var reg = Bingovista.checkSettingBox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region");
		if (!this.enums.expobject.includes(items[1]))
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in expobject");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		if (any[1] !== "true" && any[1] !== "false")
			throw new TypeError(thisname + ": shelter flag \"" + any[1] + "\" not 'true' or 'false'");
		if (this.enums.regions.indexOf(reg[1]) < 0)
			throw new TypeError(thisname + ": \"" + reg[1] + "\" not found in regions");
		var r = this.regionToDisplayText(this.board.character, reg[1]) + ".";
		if (r.length > 1) r = ", in " + r;
		var d = "";
		d += (any[1] === "true") ? "Bring " : "Hoard ";
		d += this.entityNameQuantify(amt, this.entityDisplayText(items[1]));
		d += (any[1] === "true") ? " to " : " in ";
		if (amt == 1)
			d += "a shelter";
		else if (any[1] === "true")
			d += "any shelters";
		else
			d += "the same shelter";
		d += r;
		var p = [ { type: "icon", value: this.entityIconAtlas(items[1]), scale: 1, color: this.entityIconColor(items[1]), rotation: 0 } ];
		if (any[1] === "true") {
			p.push( { type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
					{ type: "icon", value: "doubleshelter", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		} else {
			p.unshift( { type: "icon", value: "ShelterMarker", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		}
		p.push( { type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: Bingovista.colors.Unity_white } );
		if (reg[1] !== "Any Region") {
			p.splice(p.length - 2, 0, { type: "break" }, { type: "text", value: reg[1], color: Bingovista.colors.Unity_white } );
		}
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyBool(b, 1, 4, any[1] === "true");
		b[3] = amt;
		b[4] = this.enumToValue(items[1], "expobject");
		if (reg[1] !== "Any Region") {
			b[0] = this.challengeValue("BingoItemHoardExChallenge");
			b.push(this.enumToValue(reg[1], "regions"));
		}
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hoarding items in shelters",
			items: [amounts[2], items[2], reg[2]],
			values: [String(amt), items[1], reg[1]],
			description: d,
			comments: "The 'a shelter' option behaves as the base Expedition goal; count is updated on shelter close.<br>" +
					"The 'Any Shelter' option counts the total across any shelters in the world. Counts are per item ID, updated when the item is brought into a shelter. Counts never go down, so items are free to use after \"hoarding\" them, including eating or removing. Because items are tracked by ID, this goal cannot be cheesed by taking the same items between multiple shelters; multiple unique items must be hoarded. In short, it's the act of hoarding (putting a new item in a shelter) that counts up.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoKarmaFlowerChallenge: function(desc) {
		const thisname = "BingoKarmaFlowerChallenge";
		//	assert: desc of format ["0", "System.Int32|5|Amount|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "item count");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Consuming Karma Flowers",
			items: [items[2]],
			values: [String(amt)],
			description: "Consume " + this.entityNameQuantify(amt, "Karma Flowers") + ".",
			comments: "With this goal present on the board, flowers are spawned in the world in their normal locations. The player obtains the benefit of consuming the flower (protecting karma level). While the goal is in progress, players <em>do not drop</em> the flower on death. After the goal is completed or locked, a flower can drop on death as normal.",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "FlowerMarker", scale: 1, color: Bingovista.colors.SaturatedGold, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + items[1] + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoKillChallenge: function(desc) {
		const thisname = "BingoKillChallenge";
		//	assert: desc of format (< v1.2) ["System.String|Scavenger|Creature Type|0|creatures", "System.String|Any Weapon|Weapon Used|6|weaponsnojelly", "System.Int32|5|Amount|1|NULL", "0", "System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions", "System.Boolean|false|In one Cycle|3|NULL", "System.Boolean|false|Via a Death Pit|7|NULL", "System.Boolean|false|While Starving|2|NULL", "0", "0"]
		//	or (>= v1.2) [System.String|TentaclePlant|Creature Type|0|creatures", "System.String|Any Weapon|Weapon Used|6|weaponsnojelly", "System.Int32|4|Amount|1|NULL", "0", "System.String|Any Region|Region|5|regions", "System.Boolean|false|In one Cycle|3|NULL", "System.Boolean|false|Via a Death Pit|7|NULL", "System.Boolean|false|While Starving|2|NULL", "System.Boolean|false|While under mushroom effect|8|NULL", "0", "0"]
		if (desc[8] && desc[8].search("mushroom") < 0) {
			//	< v1.2: contains subregion, no mushroom
			desc.splice(9, 0, "System.Boolean|false|While under mushroom effect|8|NULL");
		} else {
			//	>= v1.2: Subregion removed; add back in dummy value for compatibility
			desc.splice(5, 0, "System.String|Any Subregion|Subregion|4|subregions");
		}
		//	now is superset: contains subregion *and* mushroom; length 12
		Bingovista.checkDescLen(thisname, desc.length, 12);
		var v = [], i = [];
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Creature Type", , "creatures"], "target selection"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[1], ["System.String", , "Weapon Used", , "weaponsnojelly"], "weapon selection"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "kill count"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[5], ["System.String", , "Subregion", , "subregions"], "subregion selection"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[6], ["System.Boolean", , "In one Cycle", , "NULL"], "one-cycle flag"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[7], ["System.Boolean", , "Via a Death Pit", , "NULL"], "death pit flag"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[8], ["System.Boolean", , "While Starving", , "NULL"], "starving flag"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[9], ["System.Boolean", , "While under mushroom effect", , "NULL"], "mushroom flag"); v.push(items[1]); i.push(items[2]);
		var r = "";
		var amt = parseInt(v[2]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + v[2] + "\" not a number or out of range");
		var c = this.entityNameQuantify(amt, "creatures");
		if (v[0] !== "Any Creature") {
			if (this.enums.creatures.indexOf(v[0]) < 0)
				throw new TypeError(thisname + ": \"" + v[0] + "\" not found in creatures");
			c = this.entityNameQuantify(amt, this.entityDisplayText(v[0]));
		}
		if (this.enums.regions.indexOf(v[3]) < 0)
			throw new TypeError(thisname + ": \"" + v[3] + "\" not found in regions");
		if (v[4] === "Journey\\'s End") v[4] = "Journey\'s End";
		if (this.enums.subregions.indexOf(v[4]) < 0)
			throw new TypeError(thisname + ": \"" + v[4] + "\" not found in subregions");
		var r = this.regionToDisplayText(this.board.character, v[3], v[4]);
		if (r > "") r = " in " + r;
		var w = ", with a death pit";
		if (!this.enums.weapons.includes(v[1]))
			throw new TypeError(thisname + ": \"" + v[1] + "\" not found in weapons");
		if (v[6] === "false") {
			if (v[1] !== "Any Weapon") {
				w = " with " + this.entityDisplayText(v[1]);
			} else {
				w = "";
			}
		}
		var p = [];
		if (v[1] !== "Any Weapon" || v[6] === "true") {
			if (v[6] === "true")
				p.push( { type: "icon", value: "deathpiticon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			else
				p.push( { type: "icon", value: this.entityIconAtlas(v[1]), scale: 1, color: this.entityIconColor(v[1]), rotation: 0 } );
		}
		if (v[5] !== "true" && v[5] !== "false")
			throw new TypeError(thisname + ": one-cycle flag \"" + v[5] + "\" not 'true' or 'false'");
		if (v[6] !== "true" && v[6] !== "false")
			throw new TypeError(thisname + ": death pit flag \"" + v[6] + "\" not 'true' or 'false'");
		if (v[7] !== "true" && v[7] !== "false")
			throw new TypeError(thisname + ": starving flag \"" + v[7] + "\" not 'true' or 'false'");
		if (v[8] !== "true" && v[8] !== "false")
			throw new TypeError(thisname + ": mushroom flag \"" + v[8] + "\" not 'true' or 'false'");
		p.push( { type: "icon", value: "Multiplayer_Bones", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		if (v[0] !== "Any Creature") {
			p.push( { type: "icon", value: this.entityIconAtlas(v[0]), scale: 1, color: this.entityIconColor(v[0]), rotation: 0 } );
		}
		p.push( { type: "break" } );
		if (v[4] === "Any Subregion") {
			if (v[3] !== "Any Region") {
				p.push( { type: "text", value: v[3], color: Bingovista.colors.Unity_white } );
				p.push( { type: "break" } );
			}
		} else {
			p.push( { type: "text", value: v[4], color: Bingovista.colors.Unity_white } );
			p.push( { type: "break" } );
		}
		p.push( { type: "text", value: "[0/" + v[2] + "]", color: Bingovista.colors.Unity_white } );
		if (v[7] === "true")
			p.push( { type: "icon", value: "Multiplayer_Death", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		if (v[5] === "true")
			p.push( { type: "icon", value: "cycle_limit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		if (v[8] === "true")
			p.push( { type: "icon", value: this.entityIconAtlas("Mushroom"), scale: 1, color: this.entityIconColor("Mushroom"), rotation: 0 } );
		var b = Array(9); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyBool(b, 1, 4, v[5] === "true");
		Bingovista.applyBool(b, 1, 5, v[6] === "true");
		Bingovista.applyBool(b, 1, 6, v[7] === "true");
		Bingovista.applyBool(b, 1, 7, v[8] === "true");
		b[3] = this.enumToValue(v[0], "creatures");
		b[4] = this.enumToValue(v[1], "weaponsnojelly");
		Bingovista.applyShort(b, 5, amt);
		b[7] = this.enumToValue(v[3], "regions");
		b[8] = this.enumToValue(v[4], "subregions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Killing creatures",
			items: i,
			values: v,
			description: "Kill " + c + r + w
					+ ((v[7] === "true") ? ", while starving" : "")
					+ ((v[5] === "true") ? ", in one cycle" : "")
					+ ((v[8] === "true") ? ", while under mushroom effect." : "."),
			comments: "Credit is determined by the last source of 'blame' at time of death. For creatures that take multiple hits, try to \"soften them up\" with more common items, before using limited ammunition to deliver the killing blow.  Creatures that \"bleed out\", can be mortally wounded (brought to or below 0 HP), before being tagged with a specific weapon to obtain credit. Conversely, weapons that do slow damage (like Spore Puff) can lose blame over time; consider carrying additional ammunition to deliver the killing blow. Starving: must be in the \"malnourished\" state; this state is cleared after eating to full.<br>" +
					"Note: the reskinned BLLs in the Past Garbage Wastes tunnel, count as both BLL and DLL for this challenge.<br>" +
					"(&lt; v1.2: If defined, <span class=\"code\">Subregion</span> takes precedence over <span class=\"code\">Region</span>. If set, <span class=\"code\">Via a Death Pit</span> takes precedence over <span class=\"code\">Weapon Used</span>.)<br>" +
					"Note: <span class=\"code\">Subregion</span> was never fully implemented, and is deprecated in v1.2+. Bingovista displays this parameter only for completeness.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoMaulTypesChallenge: function(desc) {
		const thisname = "BingoMaulTypesChallenge";
		//	desc of format "0", "System.Int32|4|Amount|0|NULL", "0", "0", ""
		Bingovista.checkDescLen(thisname, desc.length, 5);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "maul amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > this.enums["creatures"].length)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Mauling different types of creatures",
			items: ["Amount"],
			values: [String(amt)],
			description: "Maul " + String(amt) + " different types of creatures.",
			comments: "",
			paint: [
				{ type: "icon", value: "artimaulcrit", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoMaulXChallenge: function(desc) {
		const thisname = "BingoMaulXChallenge";
		//	desc of format ["0", "System.Int32|13|Amount|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "maul amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Mauling creatures a certain amount of times",
			items: ["Amount"],
			values: [String(amt)],
			description: "Maul creatures " + String(amt) + " times.",
			comments: "",
			paint: [
				{ type: "icon", value: "artimaul", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNeuronDeliveryChallenge: function(desc) {
		const thisname = "BingoNeuronDeliveryChallenge";
		//	desc of format ["System.Int32|2|Amount of Neurons|0|NULL", "0", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.Int32", , "Amount of Neurons", , "NULL"], "neuron amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var oracle = "moon";
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Gifting neurons",
			items: ["Amount"],
			values: [String(amt)],
			description: "Deliver " + this.entityNameQuantify(amt, this.entityDisplayText("SSOracleSwarmer")) + " to " + this.maps.iterators.find(o => o.name === oracle).text + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "Symbol_Neuron", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.maps.iterators.find(o => o.name === oracle).icon, scale: 1, color: this.maps.iterators.find(o => o.name === oracle).color, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNoNeedleTradingChallenge: function(desc) {
		const thisname = "BingoNoNeedleTradingChallenge";
		//	desc of format ["0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 2);
		var b = Array(3); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding gifting Needles to Scavengers",
			items: [],
			values: [],
			description: "Do not gift Needles to Scavengers.",
			comments: "",
			paint: [
				{ type: "icon", value: "spearneedle", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "commerce", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Kill_Scavenger", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNoRegionChallenge: function(desc) {
		const thisname = "BingoNoRegionChallenge";
		//	desc of format ["System.String|SI|Region|0|regionsreal", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "avoid region");
		if (this.enums.regions.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in regions");
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(items[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding a region",
			items: [items[2]],
			values: [items[1]],
			description: "Do not enter " + this.regionToDisplayText(this.board.character, items[1]) + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
				{ type: "text", value: items[1], color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPearlDeliveryChallenge: function(desc) {
		const thisname = "BingoPearlDeliveryChallenge";
		//	desc of format ["System.String|LF|Pearl from Region|0|regions", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Pearl from Region", , "regions"], "pearl region");
		if (this.enums.regions.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not found in regions");
		var oracle = "moon";
		if (this.board.character === "Artificer")
			oracle = "pebbles";
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(items[1], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering colored pearls to an Iterator",
			items: [items[2]],
			values: [items[1]],
			description: "Deliver " + this.regionToDisplayText(this.board.character, items[1]) + " colored pearl to " + this.maps.iterators.find(o => o.name === oracle).text + ".",
			comments: "",
			paint: [
				{ type: "text", value: items[1], color: Bingovista.colors.Unity_white },
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: this.entityIconColor("Pearl"), rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 90 },
				{ type: "break" },
				{ type: "icon", value: this.maps.iterators.find(o => o.name === oracle).icon, scale: 1, color: this.maps.iterators.find(o => o.name === oracle).color, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPearlHoardChallenge: function(desc) {
		const thisname = "BingoPearlHoardChallenge";
		//	desc of format (< v1.2) ["System.Boolean|false|Common Pearls|0|NULL", "System.Int32|2|Amount|1|NULL", "System.String|SL|In Region|2|regions", "0", "0"]
		//	or (>= v1.2) ["System.Boolean|true|Common Pearls|0|NULL", "System.Boolean|false|Any Shelter|2|NULL", "0", "System.Int32|2|Amount|1|NULL", "System.String|LF|Region|3|regions", "0", "0", ""]
		//	params: common, anyShelter, current, amount, region, completed, revealed, collected
		if (desc.length == 5) {
			desc.splice(1, 0, "System.Boolean|false|Any Shelter|2|NULL", "0");
			desc.push("");
		}
		Bingovista.checkDescLen(thisname, desc.length, 8);
		var common = Bingovista.checkSettingBox(thisname, desc[0], ["System.Boolean", , "Common Pearls", , "NULL"], "common pearls flag");
		var any = Bingovista.checkSettingBox(thisname, desc[1], ["System.Boolean", , "Any Shelter", , "NULL"], "any shelter flag");
		var amounts = Bingovista.checkSettingBox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "pearl count");
		desc[4] = desc[4].replace(/regionsreal/, "regions");	//	both acceptable (v0.85/0.90)
		desc[4] = desc[4].replace(/\|In Region\|/, "|Region|");	//	parameter name updated v1.25
		var reg = Bingovista.checkSettingBox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection");
		if (common[1] !== "true" && common[1] !== "false")
			throw new TypeError(thisname + ": pearl flag \"" + common[1] + "\" not 'true' or 'false'");
		if (any[1] !== "true" && any[1] !== "false")
			throw new TypeError(thisname + ": shelter flag \"" + any[1] + "\" not 'true' or 'false'");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		if (this.enums.regions.indexOf(reg[1]) < 0)
			throw new TypeError(thisname + ": \"" + reg[1] + "\" not found in regions");
		var r = this.regionToDisplayText(this.board.character, reg[1]);
		if (r > "") r = ", in " + r;
		var d = " common pearl";
		if (common[1] === "false") d = " colored pearl";
		if (amt == 1) d = "a" + d; else d = String(amt) + d + "s";
		if (any[1] === "true") d = "Bring " + d + ", to "; else d = "Hoard " + d + ", in ";
		if (amt == 1) d += "a shelter"; else if (any[1] === "true") d += "any shelters"; else d += "the same shelter";
		d += r + ".";
		var p = [ { type: "icon", value: ((common[1] === "true") ? "pearlhoard_normal" : "pearlhoard_color"), scale: 1, color: this.entityIconColor("Pearl"), rotation: 0 } ];
		if (any[1] === "true") {
			p.push( { type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
					{ type: "icon", value: "doubleshelter", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		} else {
			p.unshift( { type: "icon", value: "ShelterMarker", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		}
		if (reg[1] !== "Any Region")
			p.push( { type: "break" },
					{ type: "text", value: reg[1], color: Bingovista.colors.Unity_white } );
		p.push( { type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white } );
		var b = Array(6); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyBool(b, 1, 4, common[1] === "true");
		Bingovista.applyBool(b, 1, 5, any[1] === "true");
		Bingovista.applyShort(b, 3, amt);
		b[5] = this.enumToValue(reg[1], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Putting pearls in shelters",
			items: [common[2], any[2], amounts[2], reg[2], "collected"],
			values: [common[1], any[1], amounts[1], reg[1], desc[7]],
			description: d,
			comments: "Note: faded pearls in Saint campaign do not count toward a \"common pearls\" goal; they still count as colored.  For example, once touched, they show on the map with their assigned (vibrant) color.  Misc pearls, and those in Iterator chambers, do not count for either type of goal.<br>" +
					"The 'one shelter' option behaves as the base Expedition goal; count is updated on shelter close.<br>" +
					"The 'any shelter' option counts the total across all shelters in the world. Counts are per pearl ID, updated when the pearl is brought into a shelter. Counts never go down, so pearls are free to use after \"hoarding\" them. Because pearls are tracked by ID, this goal cannot be cheesed by taking the same pearls between multiple shelters; multiple unique pearls must be hoarded. In short, it's the act of hoarding (putting a <em>new</em> pearl <em>in</em> a shelter) that counts up.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoPinChallenge: function(desc) {
		const thisname = "BingoPinChallenge";
		//	desc of format ["0", "System.Int32|5|Amount|0|NULL", "System.String|PinkLizard|Creature Type|1|creatures", "", "System.String|SU|Region|2|regions", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 7);
		var v = [], i = [];
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pin amount"); v.push(items[1]); i.push(items[2]);
		var items = Bingovista.checkSettingBox(thisname, desc[2], ["System.String", , "Creature Type", , "creatures"], "creature type"); v.push(items[1]); i.push(items[2]);
		var items = Bingovista.checkSettingBox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		var cur = parseInt(desc[0]);
		if (isNaN(cur) || cur < 0 || cur > INT_MAX)
			throw new TypeError(thisname + ": current \"" + desc[0] + "\" not a number or out of range");
		var amt = parseInt(v[0]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + v[0] + "\" not a number or out of range");
		if (v[1] !== "Any Creature" && this.enums.creatures.indexOf(v[1]) < 0)
			throw new TypeError(thisname + ": \"" + v[1] + "\" not found in creatures");
		var c = this.entityNameQuantify(amt, this.entityDisplayText(v[1]));
		if (this.enums.regions.indexOf(v[2]) < 0)
			throw new TypeError(thisname + ": region \"" + v[2] + "\" not found in regions");
		var r = this.regionToDisplayText(this.board.character, v[2]);
		if (r === "") r = "different regions";
		var p = [ { type: "icon", value: "pin_creature", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } ];
		if (v[1] !== "Any Creature") {
			p.push( { type: "icon", value: this.entityIconAtlas(v[1]), scale: 1, color: this.entityIconColor(v[1]), rotation: 0 } );
		}
		if (v[2] === "Any Region") {
			p.push( { type: "icon", value: "TravellerA", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		} else {
			p.push( { type: "text", value: v[2], color: Bingovista.colors.Unity_white } );
		}
		p.push( { type: "break" } );
		p.push( { type: "text", value: "[" + String(cur) + "/" + String(amt) + "]", color: Bingovista.colors.Unity_white } );
		var b = Array(7); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[5] = this.enumToValue(v[1], "creatures");
		b[6] = this.enumToValue(v[2], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Pinning creatures to walls",
			items: i,
			values: v,
			description: "Pin " + c + " to walls or floors in " + r + ".",
			comments: "A creature does not need to be alive to obtain pin credit. Sometimes a body chunk gets pinned but does not credit the challenge; keep retrying on different parts of a corpse until it works. \"Different regions\" means one pin per region, as many unique regions as pins required.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoPopcornChallenge: function(desc) {
		const thisname = "BingoPopcornChallenge";
		//	desc of format ["0", "System.Int32|6|Amount|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pop amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Popping popcorn plants",
			items: [items[2]],
			values: [String(amt)],
			description: "Open " + this.entityNameQuantify(amt, "popcorn plants") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "Symbol_Spear", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "popcorn_plant", scale: 1, color: Bingovista.colors.popcorn_plant, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoRivCellChallenge: function(desc) {
		const thisname = "BingoRivCellChallenge";
		//	desc of format ["0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 2);
		var b = Array(3); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Feeding the Rarefaction Cell to a Leviathan",
			items: [],
			values: [],
			description: "Feed the Rarefaction Cell to a Leviathan (completes if you die).",
			comments: "The Rarefaction Cell's immense power disturbs time itself; hence, this goal is awarded even if the player dies in the process. May our cycles meet again, little Water Dancer...",
			paint: [
				{ type: "icon", value: "Symbol_EnergyCell", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Kill_BigEel", scale: 1, color: this.entityIconColor("BigEel"), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoSaintDeliveryChallenge: function(desc) {
		const thisname = "BingoSaintDeliveryChallenge";
		//	desc of format ["0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 2);
		var oracle = "pebbles";
		var b = Array(3); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering the Music Pearl to Five Pebbles",
			items: [],
			values: [],
			description: "Deliver the Music Pearl to " + this.maps.iterators.find(o => o.name === oracle).text + ".",
			comments: "Credit is awarded when Five Pebbles resumes playing the pearl; wait for dialog to finish, and place the pearl within reach.",
			paint: [
				{ type: "icon", value: "memoriespearl", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.maps.iterators.find(o => o.name === oracle).icon, scale: 1, color: this.maps.iterators.find(o => o.name === oracle).color, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoSaintPopcornChallenge: function(desc) {
		const thisname = "BingoSaintPopcornChallenge";
		//	desc of format ["0", "System.Int32|7|Amount|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "seed amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Eating popcorn plant seeds",
			items: [items[2]],
			values: [String(amt)],
			description: "Eat " + this.entityNameQuantify(amt, "popcorn plant seeds") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Symbol_Seed", scale: 1, color: this.entityIconColor("Default"), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoStealChallenge: function(desc) {
		const thisname = "BingoStealChallenge";
		//	assert: desc of format ["System.String|Rock|Item|1|theft",
		//	"System.Boolean|false|From Scavenger Toll|0|NULL",
		//	"0", "System.Int32|3|Amount|2|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 6);
		var v = [], i = [];
		var p = [ { type: "icon", value: "steal_item", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } ];
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Item", , "theft"], "item selection"); v.push(items[1]); i.push(items[2]);
		if (!this.enums.theft.includes(v[0]))
			throw new TypeError(thisname + ": item \"" + v[0] + "\" not in theft");
		items = Bingovista.checkSettingBox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "item count"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Boolean", , "From Scavenger Toll", , "NULL"], "venue flag"); v.push(items[1]); i.push(items[2]);
		if (this.enums.items.findIndex(s => s === v[0]) < 0)
			throw new TypeError(thisname + ": \"" + v[0] + "\" not found in items");
		var amt = parseInt(v[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + v[1] + "\" not a number or out of range");
		var d = "Steal " + this.entityNameQuantify(amt, this.entityDisplayText(v[0])) + " from ";
		p.push( { type: "icon", value: this.entityIconAtlas(v[0]), scale: 1, color: this.entityIconColor(v[0]), rotation: 0 } );
		if (v[2] === "true") {
			p.push( { type: "icon", value: "scavtoll", scale: 0.8, color: Bingovista.colors.Unity_white, rotation: 0 } );
			d += "a Scavenger Toll.";
		} else if (v[2] === "false") {
			p.push( { type: "icon", value: this.entityIconAtlas("Scavenger"), scale: 1,
					color: this.entityIconColor("Scavenger"), rotation: 0 } );
			d += "Scavengers.";
		} else {
			throw new TypeError(thisname + ": flag \"" + v[2] + "\" not 'true' or 'false'");
		}
		p.push( { type: "break" } );
		p.push( { type: "text", value: "[0/" + v[1] + "]", color: Bingovista.colors.Unity_white } );
		var b = Array(6); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(v[0], "theft");
		Bingovista.applyBool(b, 1, 4, v[2] === "true");
		Bingovista.applyShort(b, 4, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Stealing items",
			items: i,
			values: v,
			description: d,
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoTameChallenge: function(desc) {
		const thisname = "BingoTameChallenge";
		//	assert: desc of format ["System.String|EelLizard|Creature Type|0|friend", "0", "0"]
		//	or ["System.Boolean|true|Specific Creature Type|0|NULL", "System.String|BlueLizard|Creature Type|0|friend", "0", "System.Int32|3|Amount|3|NULL", "0", "0", ""]
		//	1.091 hack: allow 3 or 7 parameters; assume the existing parameters are ordered as expected
		if (desc.length == 3) {
			desc.unshift("System.Boolean|true|Specific Creature Type|0|NULL");
			desc.splice(2, 0, "0", "System.Int32|1|Amount|3|NULL");
			desc.push("");
		}
		Bingovista.checkDescLen(thisname, desc.length, 7);
		var v = [], i = [];
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.Boolean", , "Specific Creature Type", , "NULL"], "creature type flag"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[1], ["System.String", , "Creature Type", , "friend"], "friend selection"); v.push(items[1]); i.push(items[2]);
		items = Bingovista.checkSettingBox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "friend count"); v.push(items[1]); i.push(items[2]);
		var amt = parseInt(v[2]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + v[2] + "\" not a number or out of range");
		if (v[1] !== "Any Creature" && this.enums.creatures.indexOf(v[1]) < 0)
			throw new TypeError(thisname + ": \"" + v[1] + "\" not found in creatures");
		var c = this.entityNameQuantify(1, this.entityDisplayText(v[1]));
		var p = [
			{ type: "icon", value: "FriendB", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
		];
		if (v[0] === "true") {
			p.push( { type: "icon", value: this.entityIconAtlas(v[1]), scale: 1, color: this.entityIconColor(v[1]), rotation: 0 } );
		} else if (v[0] === "false") {
			p.push( { type: "break" } );
			p.push( { type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white } );
		} else {
			throw new TypeError(thisname + ": flag \"" + v[0] + "\" not 'true' or 'false'");
		}
		var b = Array(4); b.fill(0);
		//	start with classic version...
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(v[1], "friend");
		if (v[0] === "false") {
			//	...have to use expanded form
			b[0] = this.challengeValue("BingoTameExChallenge");
			Bingovista.applyBool(b, 1, 4, v[0] === "true");
			b.push(amt);
		}
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Befriending creatures",
			items: i,
			values: v,
			description: (v[0] === "true") ? ("Befriend " + c + ".") : ("Befriend [0/" + amt + "] unique creature types."),
			comments: "Taming occurs when a creature has been fed or rescued enough times to increase the player's reputation above some threshold, starting from a default depending on species, and the global and regional reputation of the player.<br>Feeding occurs when: 1. the player drops an edible item, creature or corpse, 2. within view of the creature, and 3. the creature bites that object. A \"happy lizard\" sound indicates success. The creature does not need to den with the item to increase reputation. Stealing the object back from the creature's jaws does not reduce reputation.<br>A rescue occurs when: 1. a creature sees or is grabbed by a threat, 2. the player attacks the threat (if the creatures was grabbed, the predator must be stunned enough to drop the creature), and 3. the creature sees the attack (or gets dropped because of it).<br>For the multiple-tame option, creature <i>types</i> count toward progress (multiple tames of a given type/color/species do not increase the count). Note that any befriendable creature type counts towards the total, including both Lizards and Squidcadas.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoTradeChallenge: function(desc) {
		const thisname = "BingoTradeChallenge";
		//	desc of format ["0", "System.Int32|15|Value|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Value", , "NULL"], "points value");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Trading items to Merchants",
			items: [items[2]],
			values: [String(amt)],
			description: "Trade " + String(amt) + " points worth of items to Scavenger Merchants.",
			comments: "A trade occurs when: 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. When the Scavenger is also a Merchant, points will be awarded. Any item can be traded once to award points according to its value; this includes items initially held (then dropped/traded) by Scavenger Merchants. If an item seems to have been ignored or missed, try trading it again.<br>Stealing and murder will <em>not</em> result in points being awarded.",
			paint: [
				{ type: "icon", value: "scav_merchant", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoTradeTradedChallenge: function(desc) {
		const thisname = "BingoTradeTradedChallenge";
		//	desc of format ["0", "System.Int32|3|Amount of Items|0|NULL", "empty", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 5);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount of Items", , "NULL"], "amount of items");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Trading already traded items",
			items: [items[2]],
			values: [String(amt)],
			description: "Trade " + String(amt) + ((amt == 1) ? " item" : " items") + " from Scavenger Merchants to other Scavenger Merchants.",
			comments: "A trade occurs when: 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. While this challenge is active, any item dropped by a Merchant, due to a trade, will be \"blessed\" and thereafter bear a mark indicating its eligibility for this challenge.<br>In a Merchant room, the Merchant bears a '<span style=\"color: #00ff00; font-weight: bold;\">✓</span>' tag to show who you should trade with; other Scavengers in the room are tagged with '<span style=\"color: #ff0000; font-weight: bold;\">X</span>'.<br>A \"blessed\" item can then be brought to any <em>other</em> Merchant and traded, to award credit.<br>Stealing from or murdering a Merchant will not result in \"blessed\" items dropping (unless they were already traded).",
			paint: [
				{ type: "icon", value: "scav_merchant", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "Menu_Symbol_Shuffle", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: "scav_merchant", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoTransportChallenge: function(desc) {
		const thisname = "BingoTransportChallenge";
		//	desc of format ["System.String|Any Region|From Region|0|regions", "System.String|DS|To Region|1|regions", "System.String|CicadaA|Creature Type|2|transport", "", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 6);
		var v = [], i = [];
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "From Region", , "regions"], "from region"); v.push(items[1]); i.push(items[2]);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.String", , "To Region", , "regions"], "to region"); v.push(items[1]); i.push(items[2]);
		var items = Bingovista.checkSettingBox(thisname, desc[2], ["System.String", , "Creature Type", , "transport"], "transportable creature type"); v.push(items[1]); i.push(items[2]);
		if (this.enums.regions.indexOf(v[0]) < 0)
			throw new TypeError(thisname + ": \"" + v[0] + "\" not found in regions");
		var r1 = this.regionToDisplayText(this.board.character, v[0]);
		if (this.enums.regions.indexOf(v[1]) < 0)
			throw new TypeError(thisname + ": \"" + v[1] + "\" not found in regions");
		var r2 = this.regionToDisplayText(this.board.character, v[1]);
		if (this.enums.creatures.indexOf(v[2]) < 0)
			throw new TypeError(thisname + ": \"" + v[2] + "\" not found in creatures");
		var p = [
			{ type: "icon", value: this.entityIconAtlas(v[2]), scale: 1, color: this.entityIconColor(v[2]), rotation: 0 },
			{ type: "break" }
		];
		if (v[0] !== "Any Region") p.push( { type: "text", value: v[0], color: Bingovista.colors.Unity_white } );
		p.push( { type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
		if (v[1] !== "Any Region") p.push( { type: "text", value: v[1], color: Bingovista.colors.Unity_white } );
		var b = Array(6); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(v[0], "regions");
		b[4] = this.enumToValue(v[1], "regions");
		if (this.enums.transport.includes(v[2]))
			b[5] = this.enumToValue(v[2], "transport");
		else
			b[5] = this.enumToValue(v[2], "creatures") + this.BINARY_TO_STRING_DEFINITIONS[this.challengeValue(thisname)].params[2].altthreshold - 1;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Transporting creatures",
			items: i,
			values: v,
			description: "Transport " + this.entityNameQuantify(1, this.entityDisplayText(v[2])) + " from " + r1 + " to " + r2 + ".",
			comments: "When a specific 'From' region is selected, that creature can also be brought in from an outside region, placed on the ground, then picked up in that region, to activate it for the goal. Note: keeping a swallowable creature always in stomach will NOT count in this way, nor will throwing it up and only holding in hand (and not dropping then regrabbing).",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoUnlockChallenge: function(desc) {
		const thisname = "BingoUnlockChallenge";
		//	desc of format ["System.String|SingularityBomb|Unlock|0|unlocks", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Unlock", , "unlocks"], "unlock selection");
		var p = [
			{ type: "icon", value: "arenaunlock", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
			{ type: "break" }
		];
		
		var unl = this.maps.unlocks.find(o => o.name === items[1]);
		//	of type (e.g.): { type: "red", unlockColor: Bingovista.colors.RedColor,
		//	name: "GW-safari", text: "GW", icon: "", color: "" }
		if (unl === undefined)
			throw new TypeError(thisname + ": \"" + items[1] + "\" not a recognized arena unlock");
		p[0].color = unl.unlockColor;
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
		if (unl.icon === "")
			p.push( { type: "text", value: items[1], color: Bingovista.colors.Unity_white } );
		else
			p.push( { type: "icon", value: unl.icon, scale: 1, color: unl.color, rotation: 0 } );
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, this.enumToValue(items[1], "unlocks"));
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Getting Arena Unlocks",
			items: ["Unlock"],
			values: [items[1]],
			description: "Get the " + d + " unlock.",
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoVistaChallenge: function(desc) {
		const thisname = "BingoVistaChallenge";
		//	desc of format ["CC", "System.String|CC_A10|Room|0|vista", "734", "506", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 6);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.String", , "Room", , "vista"], "item selection");
		//	desc[0] is region code
		if (desc[0] != Bingovista.regionOfRoom(items[1]))
			throw new TypeError(thisname + ": \"" + desc[0] + "\" does not match room \"" + items[1] + "\"'s region prefix");
		if (this.enums.regions.indexOf(desc[0]) < 0)
			throw new TypeError(thisname + ": \"" + desc[0] + "\" not found in regions");
		var v = this.regionToDisplayText(this.board.character, desc[0]);
		var roomX = parseInt(desc[2]);
		if (isNaN(roomX) || roomX < -INT_MAX || roomX > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + desc[2] + "\" not a number or out of range");
		var roomY = parseInt(desc[3]);
		if (isNaN(roomY) || roomY < -INT_MAX || roomY > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + desc[3] + "\" not a number or out of range");
		var idx = this.maps.vistas.findIndex(o => o.room === items[1] && o.x == roomX && o.y == roomY);
		if (idx < 0) {
			//	Can't find in list, customize it
			var b = Array(8); b.fill(0);
			b[0] = this.challengeValue(thisname);
			b[3] = this.enumToValue(desc[0], "regions");
			Bingovista.applyShort(b, 4, roomX);
			Bingovista.applyShort(b, 6, roomY);
			b = b.concat([...new TextEncoder().encode(items[1])]);
			b[2] = b.length - GOAL_LENGTH;
		} else {
			//	Use stock list for efficiency
			var b = Array(4); b.fill(0);
			b[0] = this.challengeValue("BingoVistaExChallenge");
			b[3] = idx + 1;
			b[2] = b.length - GOAL_LENGTH;
		}
		return {
			name: thisname,
			category: "Visiting Vistas",
			items: ["Region"],
			values: [desc[0]],
			description: "Reach the vista point in " + v + ".",
			comments: "Room: " + this.getMapLink(items[1], this.board.character) + " at x: " + String(roomX) + ", y: " + String(roomY) + "; is a " + ((idx >= 0) ? "stock" : "customized") + " location." + "<br>Note: the room names for certain Vista Points in Spearmaster/Artificer Garbage Wastes, and Rivulet Underhang, are not generated correctly for their world state; the equivalent rooms are however fixed up in-game, and in the map link.",
			paint: [
				{ type: "icon", value: "vistaicon", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: desc[0], color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoVistaExChallenge: function(desc) {
		return Bingovista.CHALLENGES.BingoVistaChallenge.call(this, desc);
	},
	//	Challenges are alphabetical up to here (initial version); new challenges/variants added chronologically below
	//	added 0.86 (in 0.90 update cycle)
	BingoEnterRegionFromChallenge: function(desc) {
		const thisname = "BingoEnterRegionFromChallenge";
		//	desc of format ["System.String|GW|From|0|regionsreal", "System.String|SH|To|0|regionsreal", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "From", , "regionsreal"], "from region");
		var itemTo = Bingovista.checkSettingBox(thisname, desc[1], ["System.String", , "To", , "regionsreal"], "to region");
		if (this.enums.regions.indexOf(items[1]) < 0)
			throw new TypeError(thisname + ": from \"" + items[1] + "\" not found in regions");
		if (this.enums.regions.indexOf(itemTo[1]) < 0)
			throw new TypeError(thisname + ": to \"" + itemTo[1] + "\" not found in regions");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(items[1], "regionsreal");
		b[4] = this.enumToValue(itemTo[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Entering a region from another region",
			items: [items[2], itemTo[2]],
			values: [items[1], itemTo[1]],
			description: "First time entering " + this.regionToDisplayText(this.board.character, itemTo[1]) + " must be from " + this.regionToDisplayText(this.board.character, items[1]) + ".",
			comments: "",
			paint: [
				{ type: "text", value: items[1], color: Bingovista.colors.Unity_white },
				{ type: "icon", value: "keyShiftA", scale: 1, color: Bingovista.colors.EnterFrom, rotation: 90 },
				{ type: "text", value: itemTo[1], color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoMoonCloakChallenge: function(desc) {
		const thisname = "BingoMoonCloakChallenge";
		//	desc of format ["System.Boolean|false|Deliver|0|NULL", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.Boolean", , "Deliver", , "NULL"], "delivery flag");
		if (items[1] !== "true" && items[1] !== "false")
			throw new TypeError(thisname + ": delivery flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [ { type: "icon", value: "Symbol_MoonCloak", scale: 1, color: this.entityIconColor("MoonCloak"), rotation: 0 } ];
		if (items[1] === "true") {
			p.push( { type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 } );
			p.push( { type: "icon", value: "GuidanceMoon", scale: 1, color: Bingovista.colors.GuidanceMoon, rotation: 0 } );
		}
		var b = Array(3); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyBool(b, 1, 4, items[1] === "true");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Moon's Cloak",
			items: [items[2]],
			values: [items[1]],
			description: ((items[1] === "false") ? "Obtain Moon's Cloak." : "Deliver the Cloak to Moon."),
			comments: "With only a 'Deliver' goal on the board, players will spawn with the Cloak in the starting shelter, and must deliver it to Looks To The Moon. If both Obtain and Deliver are present, players must obtain the Cloak from Submerged Superstructure first, and then deliver it.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoBroadcastChallenge: function(desc) {
		const thisname = "BingoBroadcastChallenge";
		//	desc of format ["System.String|Chatlog_SI3|Broadcast|0|chatlogs", "0", "0"]
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Broadcast", , "chatlogs"], "broadcast selection");
		var r = items[1].substring(items[1].search("_") + 1);
		if (r.search(/[0-9]/) >= 0) r = r.substring(0, r.search(/[0-9]/));
		r = this.regionToDisplayText(this.board.character, r);
		if (r > "") r = " in " + r;
		if (this.enumToValue(items[1], "chatlogs") <= 0)
			throw new TypeError(thisname + ": item \"" + items[1] + "\" not found in chatlogs");
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(items[1], "chatlogs");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Getting Chat Logs",
			items: ["Broadcast"],
			values: [items[1]],
			description: "Get the " + items[1] + " chat log" + r + ".",
			comments: "Room: " + this.getMapLink(this.maps.chatlogs.find(o => o.name === items[1]).room, this.board.character) + ".",
			paint: [
				{ type: "icon", value: "Symbol_Satellite", scale: 1, color: Bingovista.colors.WhiteColor, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: items[1], color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	/*	added 1.091:
	 *	Stubs to maintain extended BINARY_TO_STRING_DEFINITIONS entries.
	 *	See binGoalToText() and ChallengeUpgrades[]; these names are
	 *	replaced with their originals to maintain compatibility.  */
	BingoDamageExChallenge: function(desc) {
		return Bingovista.CHALLENGES.BingoDamageChallenge.call(this, desc);
	},
	BingoTameExChallenge: function(desc) {
		return Bingovista.CHALLENGES.BingoTameChallenge.call(this, desc);
	},
	/*	added 1.2 */
	BingoBombTollExChallenge: function(desc) {
		return Bingovista.CHALLENGES.BingoBombTollChallenge.call(this, desc);
	},
	BingoDodgeNootChallenge: function(desc) {
		const thisname = "BingoDodgeNootChallenge";
		//	desc of format ["System.Int32|6|Amount|0|NULL", "0", "0", "0"]
		//	amount, current, completed, revealed
		Bingovista.checkDescLen(thisname, desc.length, 4);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.Int32", , "Amount", , "NULL"], "amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 1 || amt > INT_MAX)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = this.challengeValue(thisname);
		Bingovista.applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dodging Noodlefly attacks",
			items: ["Amount"],
			values: [String(amt)],
			description: "Dodge [0/" + String(amt) + "] Noodlefly attacks.",
			comments: "",
			paint: [
				{ type: "icon", value: this.entityIconAtlas("BigNeedleWorm"), scale: 1, color: this.entityIconColor("BigNeedleWorm"), rotation: 0 },
				{ type: "icon", value: "slugtarget", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDontKillChallenge: function(desc) {
		const thisname = "BingoDontKillChallenge";
		//	desc of format ["System.String|DaddyLongLegs|Creature Type|0|creatures", "0", "0"]
		//	victim, completed, revealed
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var items = Bingovista.checkSettingBox(thisname, desc[0], ["System.String", , "Creature Type", , "creatures"], "creature type");
		if (items[1] !== "Any Creature") {
			if (this.enums.creatures.indexOf(items[1]) < 0)
				throw new TypeError(thisname + ": \"" + items[1] + "\" not found in creatures");
		}
		var p = [
			{ type: "icon", value: "buttonCrossA", scale: 1, color: Bingovista.colors.Unity_red, rotation: 0 },
			{ type: "icon", value: "Multiplayer_Bones", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 }
		];
		if (items[1] !== "Any Creature")
			p.push( { type: "icon", value: this.entityIconAtlas(items[1]), scale: 1, color: this.entityIconColor(items[1]), rotation: 0 } );
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(items[1], "creatures");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding killing creatures",
			items: [items[2]],
			values: [items[1]],
			description: "Never kill " + this.entityDisplayText(items[1]) + ".",
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoEchoExChallenge: function(desc) {
		return Bingovista.CHALLENGES.BingoEchoChallenge.call(this, desc);
	},
	BingoGourmandCrushChallenge: function(desc) {
		const thisname = "BingoGourmandCrushChallenge";
		//	desc of format ["0", "System.Int32|9|Amount|0|NULL", "0", "0", ""]
		//	current, amount, completed, revealed, crushed
		Bingovista.checkDescLen(thisname, desc.length, 5);
		var items = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "amount");
		var amt = parseInt(items[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Crushing creatures",
			items: ["Amount"],
			values: [String(amt)],
			description: "Crush " + ((amt > 1) ? (String(amt) + " unique creatures") : ("a creature")) + " by falling.",
			comments: "",
			paint: [
				{ type: "icon", value: "gourmcrush", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoItemHoardExChallenge: function(desc) {
		return Bingovista.CHALLENGES.BingoItemHoardChallenge.call(this, desc);
	},
	BingoIteratorChallenge: function(desc) {
		const thisname = "BingoIteratorChallenge";
		//	desc of format ["System.Boolean|false|Looks to the Moon|0|NULL", "0", "0"]
		//	oracle, completed, revealed
		Bingovista.checkDescLen(thisname, desc.length, 3);
		var oracle = Bingovista.checkSettingBox(thisname, desc[0], ["System.Boolean", , "Looks to the Moon", , "NULL"], "Moon flag");
		if (this.maps.iterators.find(o => o.name === oracle[1]) === undefined)
			throw new TypeError(thisname + ": flag \"" + oracle[1] + "\" not 'true' or 'false'");
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = this.enumToValue(oracle[1], "iterators");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Visiting Iterators",
			items: [oracle[2]],
			values: [oracle[1]],
			description: "Visit " + this.maps.iterators.find(o => o.name === oracle[1]).text + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "singlearrow", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "icon", value: this.maps.iterators.find(o => o.name === oracle[1]).icon, scale: 1, color: this.maps.iterators.find(o => o.name === oracle[1]).color, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoLickChallenge: function(desc) {
		const thisname = "BingoLickChallenge";
		//	desc of format ["0", "System.Int32|{0}|Amount|0|NULL", "0", "0", ""]
		//	current, amount, completed, revealed, lickers
		Bingovista.checkDescLen(thisname, desc.length, 5);
		var amounts = Bingovista.checkSettingBox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "amount");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 1)
			throw new TypeError(thisname + ": amount \"" + amounts[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = this.challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Getting licked by lizards",
			items: ["Amount"],
			values: [String(amt)],
			description: "Get licked by " + ((amt > 1) ? (String(amt) + " different individual lizards.") : ("a lizard.")),
			comments: "",
			paint: [
				{ type: "icon", value: "lizlick", scale: 1, color: Bingovista.colors.Unity_white, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: Bingovista.colors.Unity_white }
			],
			toBin: new Uint8Array(b)
		};
	}
};

/**
 *	Instructions for producing text goals.  Index with this.enums.challenges.
 *
 *	An entry shall have this structure:
 *	{
 *		name: "BingoNameOfTheChallenge",
 *		params: [],
 *		desc: "format{2}string {0} with templates {2} for param values {1}"
 *	}
 *
 *	name will generally be of the form /Bingo.*Challenge/, following the
 *	BingoChallenge class the goals inherit from.
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
BINARY_TO_STRING_DEFINITIONS = [
	{	//	Base class: no parameters, any desc allowed
		name: "BingoChallenge",
		params: [
			{ type: "string", offset: 0, size: 0, formatter: "" }	//	0: Unformatted string
		],
		desc: "{0}><"
	},
	{
		name: "BingoAchievementChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "passage" }	//	0: Passage choice
		],
		desc: "System.String|{0}|Passage|0|passage><0><0"
	},
	{
		name: "BingoAllRegionsExcept",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" },	//	0: Excluded region choice
			{ type: "number", offset: 1, size: 1, formatter: ""            },	//	1: Remaining region count
			{ type: "string", offset: 2, size: 0, formatter: "regionsreal", joiner: "|" } 	//	2: Remaining regions list
		],
		desc: "System.String|{0}|Region|0|regionsreal><{2}><0><System.Int32|{1}|Amount|1|NULL><0><0"
	},
	{
		name: "BingoBombTollChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "tolls"   },	//	0: Toll choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" } 	//	1: Pass Toll flag
		],
		desc: "System.String|{0}|Scavenger Toll|1|tolls><System.Boolean|{1}|Pass the Toll|0|NULL><0><0"
	},
	{
		name: "BingoCollectPearlChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Specific Pearl flag
			{ type: "number", offset: 0, size: 1, formatter: "pearls"  },	//	1: Pearl choice
			{ type: "number", offset: 1, size: 2, formatter: ""        } 	//	2: Item amount
		],
		desc: "System.Boolean|{0}|Specific Pearl|0|NULL><System.String|{1}|Pearl|1|pearls><0><System.Int32|{2}|Amount|3|NULL><0><0><"
	},
	{
		name: "BingoCraftChallenge",
		params: [
			{ type: "number", offset: 0,  size: 1, formatter: "craft" },	//	0: Item choice
			{ type: "number", offset: 1,  size: 2, formatter: ""      } 	//	1: Item amount
		],
		desc: "System.String|{0}|Item to Craft|0|craft><System.Int32|{1}|Amount|1|NULL><0><0><0"
	},
	{
		name: "BingoCreatureGateChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "transport", altthreshold: 64, altformatter: "creatures" },	//	0: Creature choice
			{ type: "number", offset: 1, size: 1, formatter: "" } 	//	1: Gate amount
		],
		desc: "System.String|{0}|Creature Type|1|transport><0><System.Int32|{1}|Amount|0|NULL><empty><0><0"
	},
	{
		name: "BingoCycleScoreChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Score amount
		],
		desc: "System.Int32|{0}|Target Score|0|NULL><0><0"
	},
	{
		name: "BingoDamageChallenge",
		params: [
			{ type: "number", offset: 0,  size: 1, formatter: "weapons"   },	//	0: Item choice
			{ type: "number", offset: 1,  size: 1, formatter: "creatures" },	//	1: Creature choice
			{ type: "number", offset: 2,  size: 2, formatter: ""          } 	//	2: Score amount
		],
		desc: "System.String|{0}|Weapon|0|weapons><System.String|{1}|Creature Type|1|creatures><0><System.Int32|{2}|Amount|2|NULL><0><0"
	},
	{
		name: "BingoDepthsChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "depths", altthreshold: 64, altformatter: "creatures" }	//	0: Creature choice
		],
		desc: "System.String|{0}|Creature Type|0|depths><0><0"
	},
	{
		name: "BingoDodgeLeviathanChallenge",
		params: [
		],
		desc: "0><0"
	},
	{
		name: "BingoDontUseItemChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "banitem" },	//	0: Item choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: ""        },	//	1: Pass Toll flag
			{ type: "bool",   offset: 0,  bit: 5, formatter: ""        } 	//	2: isCreature flag
		],
		desc: "System.String|{0}|Item type|0|banitem><{1}><0><0><{2}"
	},
	{
		name: "BingoEatChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: ""     },	//	0: Item amount
			{ type: "bool",   offset: 0,  bit: 4, formatter: ""     },	//	1: Creature flag
			{ type: "number", offset: 2, size: 1, formatter: "food" } 	//	2: Item choice
		],
		desc: "System.Int32|{0}|Amount|1|NULL><0><{1}><System.String|{2}|Food type|0|food><0><0"
	},
	{
		name: "BingoEchoChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "echoes"  },	//	0: Echo choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" } 	//	1: Starving flag
		],
		desc: "System.String|{0}|Region|0|echoes><System.Boolean|{1}|While Starving|1|NULL><0><0"
	},
	{
		name: "BingoEnterRegionChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" }	//	0: Region choice
		],
		desc: "System.String|{0}|Region|0|regionsreal><0><0"
	},
	{
		name: "BingoGlobalScoreChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Score amount
		],
		desc: "0><System.Int32|{0}|Target Score|0|NULL><0><0"
	},
	{
		name: "BingoGreenNeuronChallenge",
		params: [
			{ type: "bool", offset: 0, bit: 4, formatter: "boolean" }	//	0: Moon flag
		],
		desc: "System.Boolean|{0}|Looks to the Moon|0|NULL><0><0"
	},
	{
		name: "BingoHatchNoodleChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: ""        },	//	0: Hatch amount
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" } 	//	1: At Once flag
		],
		desc: "0><System.Int32|{0}|Amount|1|NULL><System.Boolean|{1}|At Once|0|NULL><0><0"
	},
	{
		name: "BingoHellChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Squares amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoItemHoardChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"   },	//	0: Any shelter flag (added v1.092)
			{ type: "number", offset: 0, size: 1, formatter: ""          },	//	1: Item amount
			{ type: "number", offset: 1, size: 1, formatter: "expobject" } 	//	2: Item choice
		],
		desc: "System.Boolean|{0}|Any Shelter|2|NULL><0><System.Int32|{1}|Amount|0|NULL><System.String|{2}|Item|1|expobject><0><0><"
	},
	{
		name: "BingoKarmaFlowerChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoKillChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "creatures"      },	//	0: Creature choice
			{ type: "number", offset: 1, size: 1, formatter: "weaponsnojelly" },	//	1: Item choice
			{ type: "number", offset: 2, size: 2, formatter: ""               },	//	2: Kill amount
			{ type: "number", offset: 4, size: 1, formatter: "regions"        },	//	3: Region choice
			//	Note: Subregion choice is still here at offset 5, but unread
			{ type: "bool", offset: 0, bit: 4, formatter: "boolean" },	//	4: One Cycle flag
			{ type: "bool", offset: 0, bit: 5, formatter: "boolean" },	//	5: Death Pit flag
			{ type: "bool", offset: 0, bit: 6, formatter: "boolean" },	//	6: Starving flag
			{ type: "bool", offset: 0, bit: 7, formatter: "boolean" } 	//	7: Mushroom flag
		],
		desc: "System.String|{0}|Creature Type|0|creatures><System.String|{1}|Weapon Used|6|weaponsnojelly><System.Int32|{2}|Amount|1|NULL><0><System.String|{3}|Region|5|regions><System.Boolean|{4}|In one Cycle|3|NULL><System.Boolean|{5}|Via a Death Pit|7|NULL><System.Boolean|{6}|While Starving|2|NULL><System.Boolean|{7}|While under mushroom effect|8|NULL><0><0",
	},
	{
		name: "BingoMaulTypesChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Creature amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0><"
	},
	{
		name: "BingoMaulXChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Creature amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoNeuronDeliveryChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		desc: "System.Int32|{0}|Amount of Neurons|0|NULL><0><0><0"
	},
	{
		name: "BingoNoNeedleTradingChallenge",
		params: [
		],
		desc: "0><0"
	},
	{
		name: "BingoNoRegionChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" }	//	0: Region choice
		],
		desc: "System.String|{0}|Region|0|regionsreal><0><0"
	},
	{
		name: "BingoPearlDeliveryChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regions" }	//	0: Region choice
		],
		desc: "System.String|{0}|Pearl from Region|0|regions><0><0"
	},
	{
		name: "BingoPearlHoardChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Common Pearls flag
			{ type: "bool",   offset: 0,  bit: 5, formatter: "boolean" },	//	1: Any Shelter flag
			{ type: "number", offset: 0, size: 2, formatter: ""        },	//	2: Pearl amount
			{ type: "number", offset: 2, size: 1, formatter: "regions" } 	//	3: Region choice
		],
		desc: "System.Boolean|{0}|Common Pearls|0|NULL><System.Boolean|{1}|Any Shelter|2|NULL><0><System.Int32|{2}|Amount|1|NULL><System.String|{3}|Region|3|regions><0><0><"
	},
	{
		name: "BingoPinChallenge",
		params: [
			{ type: "number", offset: 0,  size: 2, formatter: ""          },	//	0: Pin amount
			{ type: "number", offset: 2,  size: 1, formatter: "creatures" },	//	1: Creature choice
			{ type: "number", offset: 3,  size: 1, formatter: "regions"   } 	//	2: Region choice
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><System.String|{1}|Creature Type|1|creatures><><System.String|{2}|Region|2|regions><0><0"
	},
	{
		name: "BingoPopcornChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" },	//	0: Item amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoRivCellChallenge",
		params: [
		],
		desc: "0><0"
	},
	{
		name: "BingoSaintDeliveryChallenge",
		params: [
		],
		desc: "0><0"
	},
	{
		name: "BingoSaintPopcornChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Item amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoStealChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "theft"   },	//	0: Item choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	1: From Toll flag
			{ type: "number", offset: 1, size: 2, formatter: ""        } 	//	2: Steal amount
		],
		desc: "System.String|{0}|Item|1|theft><System.Boolean|{1}|From Scavenger Toll|0|NULL><0><System.Int32|{2}|Amount|2|NULL><0><0"
	},
	{
		name: "BingoTameChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "friend" }	//	0: Creature choice
		],
		desc: "System.String|{0}|Creature Type|0|friend><0><0"
	},
	{
		name: "BingoTradeChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Trade points amount
		],
		desc: "0><System.Int32|{0}|Value|0|NULL><0><0"
	},
	{
		name: "BingoTradeTradedChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Trade item amount (65k is a preposterous amount of trade to allow, but... just in case?)
		],
		desc: "0><System.Int32|{0}|Amount of Items|0|NULL><empty><0><0"
	},
	{
		name: "BingoTransportChallenge",
		params: [
			{ type: "number", offset: 0,  size: 1, formatter: "regions"   },	//	0: From Region choice
			{ type: "number", offset: 1,  size: 1, formatter: "regions"   },	//	1: To Region choice
			{ type: "number", offset: 2,  size: 1, formatter: "transport", altthreshold: 64, altformatter: "creatures" } 	//	2: Creature choice
		],
		desc: "System.String|{0}|From Region|0|regions><System.String|{1}|To Region|1|regions><System.String|{2}|Creature Type|2|transport><><0><0"
	},
	{
		name: "BingoUnlockChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "unlocks" }	//	0: Unlock token choice (bigger than needed, but future-proofing as it's a pretty big list already?...)
		],
		desc: "System.String|{0}|Unlock|0|unlocks><0><0"
	},
	{
		name: "BingoVistaChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regions"        },	//	0: Region choice
			{ type: "string", offset: 5, size: 0, formatter: "", joiner: ""   },	//	1: Room name (verbatim) (read to zero terminator or end of goal)
			{ type: "number", offset: 1, size: 2, signed: true, formatter: "" },	//	2: Room X coordinate (decimal)
			{ type: "number", offset: 3, size: 2, signed: true, formatter: "" } 	//	3: Room Y coordinate (decimal)
		],
		desc: "{0}><System.String|{1}|Room|0|vista><{2}><{3}><0><0"
	},
	{	//  Alternate enum version for as-generated locations
		name: "BingoVistaExChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "vista_code" } 	//	0: Vista Point choice
		],
		desc: "{0}><0><0"
	},
	{	//	added v0.86
		name: "BingoEnterRegionFromChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "regionsreal" },	//	0: From regions choice
			{ type: "number", offset: 1, size: 1, formatter: "regionsreal" } 	//	1: To regions choice
		],
		desc: "System.String|{0}|From|0|regionsreal><System.String|{1}|To|0|regionsreal><0><0"
	},
	{
		name: "BingoMoonCloakChallenge",
		params: [
			{ type: "bool", offset: 0, bit: 4, formatter: "boolean" }	//	0: Delivery choice
		],
		desc: "System.Boolean|{0}|Deliver|0|NULL><0><0"
	},
	{	//	added v1.09
		name: "BingoBroadcastChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "chatlogs" }	//	0: Chatlog selection
		],
		desc: "System.String|{0}|Broadcast|0|chatlogs><0><0"
	},
	{	//	added v1.092
		name: "BingoDamageExChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "weapons"    },	//	0: Weapon choice
			{ type: "number", offset: 1, size: 1, formatter: "creatures"  },	//	1: Creature choice
			{ type: "number", offset: 2, size: 2, formatter: ""           },	//	2: Hits amount
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"    },	//	3: One Cycle flag
			{ type: "number", offset: 4, size: 1, formatter: "regions"    },	//	4: Region choice
			{ type: "number", offset: 5, size: 1, formatter: "subregions" } 	//	5: Subregion choice
		],
		desc: "System.String|{0}|Weapon|0|weapons><System.String|{1}|Creature Type|1|creatures><0><System.Int32|{2}|Amount|2|NULL><System.Boolean|{3}|In One Cycle|0|NULL><System.String|{4}|Region|5|regions><System.String|{5}|Subregion|4|subregions><0><0"
	},
	{
		name: "BingoTameExChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	0: Specific flag
			{ type: "number", offset: 0, size: 1, formatter: "friend"  },	//	1: Creature choice
			{ type: "number", offset: 1, size: 1, formatter: ""        } 	//	2: Tame amount
		],
		desc: "System.Boolean|{0}|Specific Creature Type|0|NULL><System.String|{1}|Creature Type|0|friend><0><System.Int32|{2}|Amount|3|NULL><0><0><"
	},
	{	//	added v1.2
		name: "BingoBombTollExChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 5, formatter: "boolean"      },	//	0: Specific Toll flag
			{ type: "number", offset: 0, size: 1, formatter: "tolls"        },	//	1: Toll choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"      },	//	2: Pass Toll flag
			{ type: "number", offset: 1, size: 1, formatter: ""             },	//	3: Toll amount
			{ type: "string", offset: 2, size: 0, formatter: "tolls_bombed" } 	//	4: `bombed` dictionary
		],
		desc: "System.Boolean|{0}|Specific toll|0|NULL><System.String|{1}|Scavenger Toll|3|tolls><System.Boolean|{2}|Pass the Toll|2|NULL><0><System.Int32|{3}|Amount|1|NULL><empty><0><0"
	},
	{
		name: "BingoEchoExChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "echoes"  },	//	0: Echo choice
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean" },	//	1: Starving flag
			{ type: "number", offset: 1, size: 1, formatter: ""        },	//	2: Echo amount
			{ type: "string", offset: 2, size: 0, formatter: "regions", joiner: "|" }	//	3: Seen list
		],
		desc: "System.Boolean|false|Specific Echo|0|NULL><System.String|{0}|Region|1|echoes><System.Boolean|{1}|While Starving|3|NULL><0><System.Int32|{2}|Amount|2|NULL><0><0><{3}"
	},
	{
		name: "BingoDodgeNootChallenge",
		params: [
			{ type: "number", offset: 0, size: 2, formatter: "" }	//	0: Amount
		],
		//	amount, current, completed, revealed
		desc: "System.Int32|{0}|Amount|0|NULL><0><0><0"
	},
	{
		name: "BingoDontKillChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "creatures" }	//	0: Creature choice
		],
		//	victim, completed, revealed
		desc: "System.String|{0}|Creature Type|0|creatures><0><0"
	},
	{
		name: "BingoGourmandCrushChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Amount
		],
		//	current, amount, completed, revealed, crushed
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0><"
	},
	{
		name: "BingoIteratorChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "iterators" }	//	0: Oracle choice
		],
		//	oracle, completed, revealed
		desc: "System.Boolean|{0}|Looks to the Moon|0|NULL><0><0"
	},
	{
		name: "BingoItemHoardExChallenge",
		params: [
			{ type: "bool",   offset: 0,  bit: 4, formatter: "boolean"   },	//	0: Any shelter flag (added v1.092)
			{ type: "number", offset: 0, size: 1, formatter: ""          },	//	1: Item amount
			{ type: "number", offset: 1, size: 1, formatter: "expobject" },	//	2: Item choice
			{ type: "number", offset: 2, size: 1, formatter: "regions"   } 	//	3: Region choice
		],
		desc: "System.Boolean|{0}|Any Shelter|2|NULL><0><System.Int32|{1}|Amount|0|NULL><System.String|{2}|Item|1|expobject><System.String|{3}|Region|4|regions><0><0><"
	},
	{
		name: "BingoLickChallenge",
		params: [
			{ type: "number", offset: 0, size: 1, formatter: "" }	//	0: Lick amount
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0><"
	}
];

/**
 *	Used by binGoalToText(); list of upgraded challenges.
 *	Hacky, but allows legacy BINARY_TO_STRING_DEFINITIONS[] indices to work
 *	as intended, while updating CHALLENGES[].  Each updated challenge adds a
 *	new index to BINARY_TO_STRING_DEFINITIONS[] and a stub function to
 *	CHALLENGES[].
 *	key: new internal name
 *	value: old/external name
 *	[not present]: no change
 */
ChallengeUpgrades = {
	//	< v0.80
	"BingoVistaExChallenge":     "BingoVistaChallenge",
	//	v1.092
	"BingoDamageExChallenge":    "BingoDamageChallenge",
	"BingoTameExChallenge":      "BingoTameChallenge",
	//	v1.2
	"BingoBombTollExChallenge":  "BingoBombTollChallenge",
	"BingoEchoExChallenge":      "BingoEchoChallenge",
	"BingoItemHoardExChallenge": "BingoItemHoardChallenge"
};


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
	return Math.round(1000 - 1000 * board.toBin.length / document.getElementById("textbox").value.length) / 10;
}

/**	approx. room count in Downpour, adding up Wiki region room counts */
TOTAL_ROOM_COUNT = 1578;

/**
 *	Counts the total number of possible values/options for a given goal
 *	type (g indexing in BINARY_TO_STRING_DEFINITIONS).
 *
 *	TODO: bring in patches from below
 */
countGoalOptions(g) {
	g = parseInt(g);
	var count = 1;
	if (g < 0 || g >= this.BINARY_TO_STRING_DEFINITIONS.length) return;
	var desc = this.BINARY_TO_STRING_DEFINITIONS[g];
	for (var i = 0; i < desc.params.length; i++) {
		if (desc.params[i].type === "bool") {
			count *= 2;
		} else if (desc.params[i].type === "number") {
			if (desc.params[i].formatter === "") {
				if (desc.params[i].size == 1) {
					//	Known uses: desc.name in ["BingoAllRegionsExcept", "BingoHatchNoodleChallenge", "BingoHellChallenge", "BingoItemHoardChallenge"]
					count *= CHAR_MAX + 1;
				} else if (desc.params[i].size == 2) {
					count *= INT_MAX + 1;
				} else {
					console.log("Unexpected value: BINARY_TO_STRING_DEFINITIONS["
							+ g + "].params[" + i + "].size: " + desc.params[i].size);
				}
			} else {
				if (this.enums[desc.params[i].formatter] === undefined) {
					console.log("Unexpected formatter: BINARY_TO_STRING_DEFINITIONS["
							+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
				} else {
					count *= this.enums[desc.params[i].formatter].length;
				}
			}
		} else if (desc.params[i].type === "string" || desc.params[i].type === "pstr") {
			var exponent = desc.params[i].size;
			if (exponent == 0) {
				//	Known uses: desc.name in ["BingoChallenge", "BingoAllRegionsExcept", "BingoVistaChallenge"]
				//	Variable length; customize based on goal
				if (desc.name === "BingoChallenge" && i == 0) {
					//	Plain (UTF-8) string
					exponent = 0;
				} else if (desc.name === "BingoAllRegionsExcept" && i == 2) {
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
				console.log("Unexpected formatter: BINARY_TO_STRING_DEFINITIONS["
						+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
			} else {
				for (var j = 0; j < exponent; j++)
					count *= this.enums[desc.params[i].formatter].length - 1;
			}
		} else {
			console.log("Unsupported type: BINARY_TO_STRING_DEFINITIONS["
					+ g + "].params[" + i + "].type: " + desc.params[i].type);
		}
	}

	return count;
}

/**
 *	Use binGoalToText(goalFromNumber(g, Math.random())) to generate truly
 *	random goals.
 *	Warning, may be self-inconsistent (let alone with others on a board!).
 *	@param g goal index (in BINARY_TO_STRING_DEFINITIONS[]) to generate.
 *	@param n floating point value between 0...1; arithmetic encoded sequence
 *	of parameters.
 */ 
goalFromNumber(g, n) {
	g = parseInt(g);
	if (g < 0 || g >= this.BINARY_TO_STRING_DEFINITIONS.length) return;
	n = parseFloat(n);
	if (isNaN(n) || n < 0 || n >= 1) return;
	var r = new Uint8Array(256);
	var bytes = 0;
	var val;
	var desc = this.BINARY_TO_STRING_DEFINITIONS[g];
	r[0] = g;
	for (var i = 0; i < desc.params.length; i++) {
		if (desc.params[i].type === "bool") {
			n *= 2;
			val = Math.floor(n);
			n -= val;
			r[1 + desc.params[i].offset] |= (val << desc.params[i].bit);
			bytes = Math.max(bytes, desc.params[i].offset - 1);
		} else if (desc.params[i].type === "number") {
			val = 0;
			if (desc.name === "BingoMaulTypesChallenge") {
				n *= this.enums["creatures"].length + 1;
			} else if (desc.params[i].formatter === "regionsreal" ||
			           desc.params[i].formatter === "echoes") {
				n *= this.enums[desc.params[i].formatter].length - 1;
				val = 2;	//	exclude "Any Region" option
			} else if (desc.params[i].formatter === "") {
				val = 1;	//	no use-cases for zero amount
				if (desc.params[i].size == 1) {
					n *= CHAR_MAX;
				} else if (desc.params[i].size == 2) {
					n *= INT_MAX;
				} else {
					console.log("Unexpected value: BINARY_TO_STRING_DEFINITIONS["
							+ g + "].params[" + i + "].size: " + desc.params[i].size);
				}
			} else if (this.enums[desc.params[i].formatter] === undefined) {
				console.log("Unexpected formatter: BINARY_TO_STRING_DEFINITIONS["
						+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
			} else {
				n *= this.enums[desc.params[i].formatter].length;
				val = 1;
			}
			val += Math.floor(n);
			n -= Math.floor(n);
			if (desc.params[i].size == 1) {
				r[GOAL_LENGTH + desc.params[i].offset] = val;
			} else if (desc.params[i].size == 2) {
				Bingovista.applyShort(r, GOAL_LENGTH + desc.params[i].offset, val);
			} else {
				//	add more apply-ers here
			}
			bytes = Math.max(bytes, desc.params[i].offset + desc.params[i].size);
		} else if (desc.params[i].type === "string") {
			if (desc.params[i].size == 0) {
				//	Known uses: desc.name in ["BingoChallenge", "BingoAllRegionsExcept", "BingoVistaChallenge", "BingoBombTollExChallenge", BingoEchoExChallenge"]
				//	Variable length; customize based on goal
				if (desc.name === "BingoChallenge" && i == 0) {
					//	Plain (UTF-8) string, any length
					val = "Title Text!";
					val = new TextEncoder().encode(val);
				} else if (desc.name === "BingoAllRegionsExcept" && i == 2) {
					//	Can assign an arbitrary set of regions here
					//	usually is set to all regions (0 degrees of freedom)
					val = Array(this.enums[desc.params[i].formatter].length);
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
							"BINARY_TO_STRING_DEFINITIONS[" + g + "].params[" + i + "]");
				}
				for (var j = 0; j < val.length; j++)
					r[GOAL_LENGTH + desc.params[i].offset + j] = val[j];
				bytes = Math.max(bytes, desc.params[i].offset + val.length);
			} else {
				val = Array(desc.params[i].size);
				bytes = Math.max(bytes, desc.params[i].offset + desc.params[i].size);
				if (this.enums[desc.params[i].formatter] !== "" &&
						this.enums[desc.params[i].formatter] === undefined) {
					console.log("Unexpected formatter: BINARY_TO_STRING_DEFINITIONS["
							+ g + "].params[" + i + "].formatter: " + desc.params[i].formatter);
				} else {
					for (var j = 0; j < desc.params[i].size; j++) {
						if (this.enums[desc.params[i].formatter] === "") {
							n *= 256;
						} else {
							n *= this.enums[desc.params[i].formatter].length;
						}
						val = Math.floor(n);
						n -= val;
						r[GOAL_LENGTH + desc.params[i].offset + j] = val;
						if (this.enums[desc.params[i].formatter] > "")
							r[GOAL_LENGTH + desc.params[i].offset + j]++;
					}
				}
			}
		} else if (desc.params[i].type === "pstr") {
			console.log("Unimplemented type: \"pstr\" in " |
					"BINARY_TO_STRING_DEFINITIONS[" + g + "].params[" + i + "]");
		} else {
			console.log("Unsupported type: BINARY_TO_STRING_DEFINITIONS["
					+ g + "].params[" + i + "].type: " + desc.params[i].type);
		}
	}
	r[2] = bytes;

	return r.subarray(0, bytes + GOAL_LENGTH);
}

/**
 *	Generates n goals, of type g (index in BINARY_TO_STRING_DEFINITIONS),
 *	with very random settings.
 */
generateRandomGoals(g, n) {
	g = parseInt(g);
	if (g < 0 || g >= this.BINARY_TO_STRING_DEFINITIONS.length) return;
	n = parseInt(n);
	if (n < 0) return;
	var s = "White;";
	for (var i = 0;;) {
		s += binGoalToText(goalFromNumber(g, Math.random()));
		if (++i >= n) break;
		s += "bChG";
	}
	document.getElementById("textbox").value = s;

	return s;
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
		goalNum = Math.floor(Math.random() * (this.BINARY_TO_STRING_DEFINITIONS.length - GENERATE_BLACKLIST.length));
		for (var j = 0; j < GENERATE_BLACKLIST.length; j++) {
			if (goalNum >= GENERATE_BLACKLIST[j]) goalNum++;
		}
		for (retries = 0; retries < 100; retries++) {
			goalTxt = binGoalToText(goalFromNumber(goalNum, Math.random()));
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
	for (var i = 0; i < this.BINARY_TO_STRING_DEFINITIONS.length - GENERATE_BLACKLIST.length; i++) {
		goalNum = i;
		for (var j = 0; j < GENERATE_BLACKLIST.length; j++) {
			if (goalNum >= GENERATE_BLACKLIST[j]) goalNum++;
		}
		s += binGoalToText(goalFromNumber(goalNum, Math.random())) + "bChG";
	}
	s = s.substring(0, s.length - 4);
	document.getElementById("textbox").value = s;
	parseButton();
}

/* * * End of class * * */
}

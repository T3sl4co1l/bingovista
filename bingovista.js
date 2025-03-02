/*
some more TODOs:
- nudge around board view by a couple pixels to spread out rounding errors
- board server to...basically URL-shorten?
- ???
- no profit, this is for free GDI
- Streamline challenge parsing? compactify functions? or reduce to structures if possible?

Stretchier goals:
- Board editing, of any sort
    * Drag and drop to move goals around
	* Make parameters editable
	* Port generator code over??
*/


/* * * Constants and Defaults * * */

/* HTML IDs */
const ids = {
	clear: "clear",
	textbox: "textbox",
	parse: "parse",
	copy: "copy",
	load: "fileload",
	drop: "droptarget",
	board: "board",
	boardbox: "boardcontainer",
	cursor: "cursor",
	square: "square",
	desc: "desctxt",
	meta: "header",
	metatitle: "hdrttl",
	metasize: "hdrsize",
	metabutton: "hdrshow",
	metaperks: "hdrperks",
	metamods: "hdrmods",
	charsel: "hdrchar",
	shelter: "hdrshel",
	message: "errorbox",
	darkstyle: "darkmode",
	radio1: "dark",
	radio2: "light",
	detail: "kibitzing",
	perks: "perkscheck"
};

/**
 *	List of sprite atlases, in order of precedence, highest to lowest.
 *	drawIcon() searches this list, in order, for an icon it needs.
 *	These are pre-loaded on startup from the named references, but unnamed or external
 *	references can be added by pushing (least priority), shifting (most), or inserting
 *	(anywhere) additional data.
 */
const atlases = [
	{ img: "bingoicons_mod.png", txt: "bingoicons_mod.txt", canv: undefined, frames: {} },	/**< from Bingo mod (with Vista additions) */
	{ img: "uispritesmsc.png",   txt: "uispritesmsc.txt",   canv: undefined, frames: {} }, 	/**< from DLC */
	{ img: "uiSprites.png",      txt: "uiSprites.txt",      canv: undefined, frames: {} } 	/**< from base game */
];

/**
 *	Bingo square graphics, dimensions (in px) and other properties.
 *	Adjusted by parseText() to fit to canvas; see also: drawSquare calls 
 */
const square = {
	width: 85,
	height: 85,
	margin: 4,
	border: 2,
	color: "#ffffff",
	background: "#020204",
	font: "600 10pt \"Segoe UI\", sans-serif"
};

/** Maximum accepted value for Int32 challenge parameters. In-game default seems to be 500; binary format has a hard limit of 32767 (signed) or 65535 (unsigned). Somewhere around 30k seems reasonable enough?  */
const INT_MAX = 30000;
/** Similar to INT_MAX, but for challenges *very* unlikely to need even a full byte */
const CHAR_MAX = 250;

/**	Supported mod version */
const VERSION_MAJOR = 0, VERSION_MINOR = 90;

/** Binary header length, bytes */
const HEADER_LENGTH = 21;
/** Binary goal length, bytes */
const GOAL_LENGTH = 3;

/** Used by getMapLink(); set to "" to disable */
var map_link_base = "https://noblecat57.github.io/map.html";


/* * * Global Variables * * */

/**
 *	The board.
 *	When not initialized / in gross error: undefined
 *	Else, this structure:
 *	{
 *		comments: <string>, 	//	"Untitled" by default
 *		character: <string>,	//	one of BingoEnum_CHARACTERS
 *		perks: <int>,       	//	bitmask of BingoEnum_PERKS
 *		shelter: <string>,  	//	starting shelter (blank if random)
 *		mods: [],           	//	TODO: list of modpacks (hash, name, reference?) in order of addition
 *		size: <int>,
 *		width: <int>,       	//	for now, width = height = size, but this allows
 *		height: <int>,      	//	support of rectangular grids in the future
 *		goals: [
 *			{
 *				name: "BingoGoalName", // name of CHALLENGES method which produced it
 *				category: <string>,
 *				items: [(<string>, ...)],
 *				values: [(<string>, ...)],
 *				description: <string>,
 *				comments: <string>,
 *				paint: [
 *					//	any of the following, in any order:
 *					{ type: "icon", value: <string>, scale: <number>, color: <HTMLColorString>, rotation: <number> },
 *					{ type: "break" },
 *					{ type: "text", value: <string>, color: <HTMLColorString> },
 *				],
 *				toBin: <Uint8Array>
 *			},
 *
 *			( . . . )
 *
 *		]
 *	};
 */
var board;

/**
 *	Current selection cursor on the board (click on board, or focus board 
 *	and use arrow keys).  undefined: no selection; else: { row:, col: }
 */
var selected;


/** Flag to reveal full detail on otherwise-hidden challenges (e.g. Vista Points), and extended commentary */
var kibitzing = false;


/* * * Functions * * */

/* * * Event Handlers and Initialization * * */

document.addEventListener("DOMContentLoaded", function() {

	square.color = colorFloatToString(RainWorldColors.Unity_white);

	//	File load stuff
	document.getElementById(ids.clear).addEventListener("click", function(e) {
		document.getElementById(ids.textbox).value = "";
		var u = new URL(document.URL);
		u.search = "";
		history.replaceState(null, "", u.href);
	});
	document.getElementById(ids.parse).addEventListener("click", parseText);
	document.getElementById(ids.copy).addEventListener("click", copyText);
	document.getElementById(ids.textbox).addEventListener("paste", pasteText);
	document.getElementById(ids.boardbox).addEventListener("click", clickBoard);
	document.getElementById(ids.metabutton).addEventListener("click", clickShowPerks);
	document.getElementById(ids.boardbox).addEventListener("keydown", navSquares);
	document.getElementById(ids.load).addEventListener("change", function() { doLoadFile(this.files) } );
	document.getElementById(ids.radio1).addEventListener("input", toggleDark);
	document.getElementById(ids.radio2).addEventListener("input", toggleDark);
	document.getElementById(ids.detail).addEventListener("input", toggleKibs);

	var d = document.getElementById(ids.drop);
	d.addEventListener("dragenter", dragEnterOver);
	d.addEventListener("dragover", dragEnterOver);
	d.addEventListener("dragleave", function(e) { this.style.backgroundColor = ""; } );
	d.addEventListener("drop", dragDrop);

	function dragEnterOver(e) {
		if (e.dataTransfer.types.includes("text/plain")
				|| e.dataTransfer.types.includes("Files")) {
			e.preventDefault();
			if (document.getElementById(ids.radio1).checked)
				this.style.backgroundColor = "#686868";
			else
				this.style.backgroundColor = "#c8c8c8";
		}
	}

	//	Prepare atlases

	function loadImage(src, dest) {
		return new Promise(function (resolve, reject) {
			var img = document.createElement("img");
			img.addEventListener("load", function() {
				var canv = document.createElement("canvas");
				canv.width = img.naturalWidth; canv.height = img.naturalHeight;
				var ctx = canv.getContext("2d");
				ctx.drawImage(img, 0, 0);
				dest.canv = canv;
				//console.log("resolved: image load: " + src);
				resolve();
			});
			img.crossOrigin = "anonymous";
			img.addEventListener("error", () => reject( { message: "Error loading image " + src + "." } ) );
			img.src = src;
			//console.log("Promise executed: " + src + " image load");
		});
	}

	function loadJson(src, dest) {
		//console.log("loadJson: called, src: " + src);
		return fetch(src).then(function(response, reject) {
			if (!response.ok)
				return reject(new NetworkError("URL " + response.url + " error " + response.status + " " + response.statusText + "."));
			//console.log("resolved: " + src + " fetch");
			return response.text();
		}).catch( (e) => {
			return Promise.reject(e);
		}).then((s) => {
			dest.frames = JSON.parse(s).frames;
		});
	}

	function loadClosure(s, d, f) {
		return f(s, d);
	}

	var loaders = [];
	for (var i = 0; i < atlases.length; i++) {
		loaders.push(loadClosure(atlases[i].img, atlases[i], loadImage));
	};
	for (var i = 0; i < atlases.length; i++) {
		loaders.push(loadClosure(atlases[i].txt, atlases[i], loadJson));
	};
	Promise.all(loaders).catch(function(e) {
		console.log("Promise.all(): failed to complete fetches. Error: " + e.message);
	}).finally(function() {

		//	resources loaded, final init

		var u = new URL(document.URL).searchParams;
		if (u.has("a")) {
			//	Plain text / ASCII string
			//	very inefficient, unlikely to be used, but provided for completeness
			document.getElementById(ids.textbox).value = u.get("a");
		} else if (u.has("b")) {
			//	Binary string, base64 encoded
			var s = "";
			try {
				//	Undo URL-safe escapes...
				s = u.get("b").replace(/-/g, "+").replace(/_/g, "/");
				var ar = new Uint8Array(atob(s).split("").map( c => c.charCodeAt(0) ));
				board = binToString(ar);
			} catch (e) {
				setError("Error parsing URL: " + e.message);
			}
			document.getElementById(ids.textbox).value = board.text;
		} else if (u.has("q")) {
			//	Query, fetch from remote server to get board data

			//
		}
		parseText();

	});

	//	Other housekeeping

	if (document.getElementById(ids.radio1).checked)
		document.getElementById(ids.darkstyle).media = "screen";
	else
		document.getElementById(ids.darkstyle).media = "none";

	kibitzing = !!document.getElementById(ids.detail).checked;

});

/**
 *	Color theme button changed.
 */
function toggleDark(e) {
	if (document.getElementById(ids.radio1).checked)
		document.getElementById(ids.darkstyle).media = "screen";
	else
		document.getElementById(ids.darkstyle).media = "none";
}

function toggleKibs(e) {
	kibitzing = !!document.getElementById(ids.detail).checked;
	if (selected !== undefined)
		selectSquare(selected.col, selected.row);
}

/**
 *	Data dropped onto the page.
 */
function dragDrop(e) {
	e.preventDefault();
	this.style.backgroundColor = "";
	var d = e.dataTransfer;
	setError("");
	if (d.types.includes("Files")) {
		doLoadFile(d.files);
	} else {
		var s;
		for (var i = 0; i < d.items.length; i++) {
			if (d.items[i].type.match("^text/plain")) {
				d.items[i].getAsString(function(s) {
					document.getElementById(ids.textbox).value = s;
					parseText();
				});
				return;
			}
		}
		setError("Please drop a text file.");
	}
}

/**
 *	Sets a message in the error box.
 */
function setError(s) {
	var mb = document.getElementById(ids.message);
	while (mb.childNodes.length) mb.removeChild(mb.childNodes[0]);
	mb.appendChild(document.createTextNode(s));
}

function doLoadFile(files) {
	for (var i = 0; i < files.length; i++) {
		if (files[i].type.match("^text/plain")) {
			var fr = new FileReader();
			fr.onload = function() {
				document.getElementById(ids.textbox).value = this.result;
				parseText();
			};
			fr.onerror = function(e) {
				setError("File read error: " + e.message);
			};
			fr.readAsText(files[i]);
			return;
		}
	}
	setError("Please select a text file.");
}

/**
 *	Parses an encoded string into a text-formatted board.
 */
function boardEncodeToText(s) {
	return s;
}

/**
 *	Parse Text button pressed.
 */
function parseText(e) {
	var s = document.getElementById(ids.textbox).value;
	s = s.trim().replace(/\s*bChG\s*/g, "bChG");
	document.getElementById(ids.textbox).value = s;
	var goals = s.split(/bChG/);
	var size = Math.ceil(Math.sqrt(goals.length));
	if (board === undefined) {
		board = {
			comments: "Untitled",
			character: "Any",
			perks: 0,
			shelter: "",
			mods: [],
			size: size,
			width: size,
			height: size,
			goals: [],
			toBin: undefined
		};
	} else {
		//	Board already exists, parse meta from the document
		if (document.getElementById(ids.metatitle) !== null)
			board.comments = document.getElementById(ids.metatitle).innerText || "Untitled";
		if (document.getElementById(ids.charsel) !== null)
			board.character = document.getElementById(ids.charsel).innerText;
		if (document.getElementById(ids.shelter) !== null) {
			board.shelter = document.getElementById(ids.shelter).innerText;
			if (board.shelter == "random") board.shelter = "";
		}
		for (var i = 0, el; i < Object.values(BingoEnum_EXPFLAGS).length; i++) {
			el = document.getElementById(ids.perks + String(i));
			if (el !== null) {
				if (el.checked)
					board.perks |= Object.values(BingoEnum_EXPFLAGS)[i];
				else
					board.perks &= ~Object.values(BingoEnum_EXPFLAGS)[i];
			} else
				break;
		}
		board.goals = [];
		board.size = size; board.width = size; board.height = size;
	}

	//	Detect board version:
	//	assertion: no challenge names are shorter than 14 chars (true as of 0.90)
	//	assertion: no character names are longer than 10 chars (true of base game + Downpour)
	//	0.90: character prefix, ";" delimited --> check within first 12 chars
	//	0.86: character prefix, "_" delimited --> check within first 12 chars
	//	0.85: no prefix, gonzo right into the goal list --> first token (to "~") is valid goal name or error
	if (goals[0].search(/[A-Za-z]{1,12}[_;]/) == 0) {
		//	Seems 0.86 or 0.90, find which
		if (goals[0].indexOf(";") > 0) {
			board.version = "0.90";
			board.character = goals[0].substring(0, goals[0].indexOf(";"));
			goals[0] = goals[0].substring(goals[0].indexOf(";") + 1);
		} else if (goals[0].indexOf("_") > 0) {
			board.version = "0.86";
			board.character = goals[0].substring(0, goals[0].indexOf("_"));
			goals[0] = goals[0].substring(goals[0].indexOf("_") + 1);
		}
		board.character = BingoEnum_CharToDisplayText[board.character] || "Any";
	} else {
		board.version = "0.85";
	}

	for (var i = 0; i < goals.length; i++) {
		var type, desc;
		if (goals[i].search("~") > 0 && goals[i].search("><") > 0) {
			[type, desc] = goals[i].split("~");
			desc = desc.split(/></);
			if (CHALLENGES[type] !== undefined) {
				try {
					board.goals.push(CHALLENGES[type](desc));
				} catch (er) {
					board.goals.push(defaultGoal(type, desc));
					board.goals[board.goals.length - 1].description = "Error, " + er.message + "; Descriptor: " + goals[i].split("~")[1];
				}
			} else {
				board.goals.push(defaultGoal(type, desc));
			}
		} else {
			board.goals.push(CHALLENGES["BingoChallenge"]( [ goals[i] ] ));
		}
	}
	if (goals.length == 0)
		board.goals.push(CHALLENGES["BingoChallenge"]("blank"));

	function defaultGoal(t, d) {
		return {
			name: "BingoChallenge",
			category: t,
			items: [],
			values: [],
			description: "Unknown goal. Descriptor: " + d.join("><"),
			comments: "",
			paint: [
				{ type: "text", value: "∅", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 }
			],
			toBin: new Uint8Array([BingoEnum_CHALLENGES.indexOf("BingoChallenge"), 0])
		};
	}

	if (selected !== undefined) {
		//	See if we can re-select the same square (position) in the new board
		if (selected.row < board.height && selected.col < board.width) {
			selectSquare(selected.col, selected.row);
		} else {
			selected = undefined;
		}
	}
	if (selected === undefined)
		selectSquare(-1, -1);

	//	Adjust graphical dimensions based on canvas and board sizes
	var canv = document.getElementById(ids.board);
	square.margin = Math.max(Math.round((canv.width + canv.height) * 2 / ((board.width + board.height) * 91)) * 2, 2);
	square.width = Math.round((canv.width / board.width) - square.margin - square.border);
	square.height = Math.round((canv.height / board.height) - square.margin - square.border);

	//	Redraw the board
	var ctx = document.getElementById(ids.board).getContext("2d");
	ctx.fillStyle = square.background;
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	for (var i = 0; i < board.goals.length; i++) {
		drawSquare(ctx, board.goals[i],
				Math.floor(i / board.height) * (square.width + square.margin + square.border)
					+ (square.border + square.margin) / 2,
				(i % board.height) * (square.height + square.margin + square.border)
					+ (square.border + square.margin) / 2,
				square);
	}

	//	Fill meta table with board info
	var el = document.getElementById(ids.metatitle);
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(board.comments));
	el = document.getElementById(ids.metasize);
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(String(board.width) + " x " + String(board.height)));
	el = document.getElementById(ids.charsel);
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(board.character || "Any"));
	el = document.getElementById(ids.shelter);
	while (el.childNodes.length) el.removeChild(el.childNodes[0]);
	el.appendChild(document.createTextNode(board.shelter || "random"));
	perksToChecksList(board.perks);
	addModsToHeader(board.mods);

	//	prepare board binary encoding
	board.toBin = boardToBin(board);
	//	Avoid some URL escaping with a simple substitution...
	var s = btoa(String.fromCharCode.apply(null, board.toBin));
	s = s.replace(/\+/g, "").replace(/\//g, "_");
	var u = new URL(document.URL);
	u.searchParams.set("b", s);
	history.replaceState(null, "", u.href);

	return;

	function perksToChecksList(p) {
		var elem = document.getElementById(ids.metaperks);
		while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
		var l = Object.keys(BingoEnum_EXPFLAGS);
		for (var i = 0; i < l.length; i++) {
			var label = document.createElement("label");
			var check = document.createElement("input");
			check.setAttribute("type", "checkbox");
			check.setAttribute("id", ids.perks + String(i));
			if (p & BingoEnum_EXPFLAGS[l[i]])
				check.setAttribute("checked", "");
			label.appendChild(check);
			label.appendChild(document.createTextNode(BingoEnum_EXPFLAGSNames[l[i]]));
			elem.appendChild(label);
		}
	}

}

/**
 *	Pasted to textbox.
 */
function pasteText(e) {
	//	Let default happen, but trigger a parse in case no edits are required by the user
	setTimeout(parseText, 10);
}

/**
 *	Clicked on Copy.
 */
function copyText(e) {
	navigator.clipboard.writeText(document.getElementById(ids.textbox).value);
}

/**
 *	Clicked on Show/Hide.
 */
function clickShowPerks(e) {
	var elem = document.getElementById(ids.metaperks);
	if (elem.style.display == "none")
		elem.style.display = "initial";
	else
		elem.style.display = "none";
}

/**
 *	Clicked on canvas.
 */
function clickBoard(e) {
	if (board !== undefined) {
		var rect = document.getElementById(ids.boardbox).getBoundingClientRect();
		var x = Math.floor(e.clientX - Math.round(rect.left)) - (square.border + square.margin) / 2;
		var y = Math.floor(e.clientY - Math.round(rect.top )) - (square.border + square.margin) / 2;
		var sqWidth = square.width + square.margin + square.border;
		var sqHeight = square.height + square.margin + square.border;
		var col = Math.floor(x / sqWidth);
		var row = Math.floor(y / sqHeight);
		if (x >= 0 && y >= 0 && (x % sqWidth) < (sqWidth - square.margin)
				&& (y % sqHeight) < (sqHeight - square.margin)) {
			selectSquare(col, row);
		} else {
			selectSquare(-1, -1);
		}
	}
}

/**
 *	Select the square at (col, row) to show details of.
 *	If either argument is out of range, clears the selection instead.
 */
function selectSquare(col, row) {
	var el = document.getElementById(ids.desc);
	var ctx = document.getElementById(ids.square).getContext("2d");
	if (row >= 0 && col >= 0 && row < board.height && col < board.width) {
		var goal = board.goals[row + col * board.height];
		if (goal === undefined) {
			clearDescription();
			return;
		}
		selected = { row: row, col: col };
		ctx.fillStyle = square.background;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		var size = {}; Object.assign(size, square);
		size.margin = 4;
		size.width = ctx.canvas.width - size.margin - size.border;
		size.height = ctx.canvas.height - size.margin - size.border;
		drawSquare(ctx, goal, (size.border + size.margin) / 2, (size.border + size.margin) / 2, size);

		while (el.childNodes.length) el.removeChild(el.childNodes[0]);
		var el2 = document.createElement("div"); el2.setAttribute("class", "descch");
		el2.appendChild(document.createTextNode("Challenge: " + goal.category));
		el.appendChild(el2);
		el2 = document.createElement("div"); el2.setAttribute("class", "descdesc");
		//	If content is "trusted", let it use HTML; else, escape it because it contains board text that's illegal HTML
		if (goal.name == "BingoChallenge")
			el2.appendChild(document.createTextNode(goal.description));
		else
			el2.innerHTML = goal.description;
		el.appendChild(el2);
		el2 = document.createElement("table"); el2.setAttribute("class", "desclist");
		var el3 = document.createElement("thead");
		var tr = document.createElement("tr");
		var td = document.createElement("td"); td.appendChild(document.createTextNode("Parameter")); tr.appendChild(td);
		td = document.createElement("td"); td.appendChild(document.createTextNode("Value")); tr.appendChild(td);
		el3.appendChild(tr);
		el3 = document.createElement("tbody");
		for (var i = 0; i < goal.items.length && i < goal.values.length; i++) {
			if (goal.items[i].length > 0) {
				tr = document.createElement("tr");
				td = document.createElement("td"); td.appendChild(document.createTextNode(goal.items[i]));
				tr.appendChild(td);
				td = document.createElement("td"); td.appendChild(document.createTextNode(goal.values[i]));
				tr.appendChild(td);
				el3.appendChild(tr);
			}
		}
		el2.appendChild(el3);
		el.appendChild(el2);

		if (kibitzing && goal.comments.length > 0) {
			el2 = document.createElement("div"); el2.setAttribute("class", "desccomm");
			el2.innerHTML = goal.comments;
			el.appendChild(el2);
		}

		//	position cursor
		var curSty = document.getElementById(ids.cursor).style;
		curSty.width  = String(square.width  + square.border - 4) + "px";
		curSty.height = String(square.height + square.border - 4) + "px";
		curSty.left = String(square.margin / 2 - 0 + col * (square.width + square.margin + square.border)) + "px";
		curSty.top  = String(square.margin / 2 - 0 + row * (square.height + square.margin + square.border)) + "px";
		curSty.display = "initial";
		return;
	}
	clearDescription();

	function clearDescription() {
		selected = undefined;
		ctx.fillStyle = square.background;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		while (el.childNodes.length) el.removeChild(el.childNodes[0]);
		el.appendChild(document.createTextNode("Select a square to view details."));
		document.getElementById(ids.cursor).style.display = "none";
	}

	/** maybe this is why I should build by objects instead of String into HTML directly? */
	function escapeHTML(s) {
		var el = document.createElement("div");
		el.appendChild(document.createTextNode(s));
		return el.innerHTML;
	}
}

/**
 *	Key input to document; pare down to arrow keys for navigating squares
 */
function navSquares(e) {
	if (board !== undefined && [ids.board, ids.boardbox, ids.cursor].includes(e.target.id)) {
		var dRow = 0, dCol = 0;
		if (e.key == "Up"    || e.key == "ArrowUp"   ) dRow = -1;
		if (e.key == "Down"  || e.key == "ArrowDown" ) dRow = 1;
		if (e.key == "Left"  || e.key == "ArrowLeft" ) dCol = -1;
		if (e.key == "Right" || e.key == "ArrowRight") dCol = 1;
		if (dRow || dCol) {
			e.preventDefault();
			var col = 0, row = 0;
			if (selected !== undefined) {
				col = selected.col;
				row = selected.row;
			}
			row += dRow; col += dCol;
			if (row < 0) row += board.height;
			if (row >= board.height) row -= board.height;
			if (col < 0) col += board.width;
			if (col >= board.width) col -= board.width;
			selectSquare(col, row);
		}
	}
}

/**
 *	Draw a challenge square to the specified canvas at the specified location (top-left corner).
 */
function drawSquare(ctx, goal, x, y, size) {
	ctx.beginPath();
	ctx.strokeStyle = size.color;
	ctx.lineWidth = size.border;
	ctx.lineCap = "butt";
	ctx.moveTo(x, y);
	ctx.lineTo(x + size.width, y);
	ctx.moveTo(x + size.width, y);
	ctx.lineTo(x + size.width, y + size.height);
	ctx.moveTo(x + size.width, y + size.height);
	ctx.lineTo(x, y + size.height);
	ctx.moveTo(x, y + size.height);
	ctx.lineTo(x, y);
	ctx.stroke();
	ctx.imageSmoothingEnabled = "false";
	var lines = [], thisLine = [];
	for (var i = 0; i < goal.paint.length; i++) {
		if (goal.paint[i].type == "break") {
			lines.push(thisLine);
			thisLine = [];
		} else {
			thisLine.push(goal.paint[i]);
		}
	}
	if (thisLine.length) lines.push(thisLine);
	ctx.font = size.font;
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	var xBase, yBase;
	for (var i = 0; i < lines.length; i++) {
		if (lines.length == 2)	//	not sure why this special case, but it seems to better match how the mod has it
			yBase = y + size.border / 2 + (size.height - size.border) * (i + 1) / (lines.length + 1);
		else
			yBase = y + size.border / 2 + (size.height - size.border) * (i + 0.5) / lines.length;
		yBase = Math.round(yBase);
		for (var j = 0; j < lines[i].length; j++) {
			if (lines[i].length == 2)
				xBase = x + size.border / 2 + (size.width - size.border) * (j + 1) / (lines[i].length + 1);
			else
				xBase = x + size.border / 2 + (size.width - size.border) * (j + 0.5) / lines[i].length;
			xBase = Math.round(xBase);
			if (lines[i][j].type == "icon") {
				drawIcon(ctx, lines[i][j].value, xBase, yBase, lines[i][j].color, lines[i][j].scale, lines[i][j].rotation); 
			} else if (lines[i][j].type == "text") {
				ctx.fillStyle = lines[i][j].color;
				ctx.fillText(lines[i][j].value, xBase, yBase);
			} else {
				//	unimplemented
				drawIcon(ctx, "Futile_White", xBase, yBase, colorFloatToString(RainWorldColors.Unity_white), lines[i][j].scale || 1, lines[i][j].rotation || 0); 
			}
		}
	}
}

/**
 *	Draws the specified icon to the canvas, at location (on center).
 */
function drawIcon(ctx, icon, x, y, colr, scale, rot) {
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
		for (var i = 0; i < atlases.length; i++) {
			spri = atlases[i].frames[icon + ".png"];
			src = atlases[i].canv;
			if (spri !== undefined)
				break;
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
 *	Converts a validated board in text, to binary format.
 */
function boardToBin(b) {
	var e = new TextEncoder();
	var hdr = new Uint8Array(HEADER_LENGTH);
	var comm = e.encode(b.comments + "\u0000");
	var shelter = e.encode(b.shelter + "\u0000");
	var mods = modsToArray(b.mods);
	//	struct bingo_header_s {
	//	uint32_t magicNumber;
	applyLong(hdr, 0, 0x69427752); 	//	"RwBi" = Rain World BIngo board
	//	uint8_t version_major; uint8_t version_minor;
	hdr[4] = VERSION_MAJOR; hdr[5] = VERSION_MINOR;
	//	uint8_t boardWidth; uint8_t boardHeight;
	hdr[6] = b.width; hdr[7] = b.height;
	//	uint8_t character;
	hdr[8] = Object.values(BingoEnum_CharToDisplayText).indexOf(b.character) + 1;
	//	uint16_t shelter;
	applyShort(hdr, 9, hdr.length + comm.length);
	//	uint32_t perks;
	applyLong(hdr, 11, b.perks);
	//	uint16_t goals;
	applyShort(hdr, 15, hdr.length + comm.length + shelter.length + mods.length);
	//	uint16_t mods;
	applyShort(hdr, 17, ((mods.length > 0) ? hdr.length + comm.length + shelter.length : 0));
	//	uint16_t reserved;
	applyShort(hdr, 19, 0);
	//	uint8_t[] comments;
	//	};
	var gLen = 0;
	for (var i = 0; i < b.goals.length; i++) {
		gLen += b.goals[i].toBin.length;
	}
	var r = new Uint8Array(hdr.length + comm.length + shelter.length + mods.length + gLen);
	var offs = 0;
	r.set(hdr, offs); offs += hdr.length;
	r.set(comm, offs); offs += comm.length;
	r.set(shelter, offs); offs += shelter.length;
	r.set(mods, offs); offs += mods.length;
	for (var i = 0; i < b.goals.length; i++) {
		r.set(b.goals[i].toBin, offs); offs += b.goals[i].toBin.length;
	}

	return r;

	function modsToArray(m) {
		var a = [];
		var enc = new TextEncoder();
		for (var i = 0; i < m.length; i++) {
			//	serialize mod entries here
		}
		return Uint8Array.from(a);
	}

}

/**
 *	Converts binary format to a board in text format.
 */
function binToString(a) {
	//	Minimum size to read full header
	if (a.length < HEADER_LENGTH)
		throw new TypeError("binToString: insufficient data, found " + String(a.length) + ", expected: " + String(HEADER_LENGTH) + " bytes");
	//	uint32_t magicNumber;
	if (readLong(a, 0) != 0x69427752)
		throw new TypeError("binToString: unknown magic number: 0x" + readLong(a, 0).toString(16) + ", expected: 0x69427752");
	//	(6, 7) uint8_t boardWidth; uint8_t boardHeight;
	var b = {
		comments: "Untitled",
		character: "Any",
		perks: 0,
		shelter: "",
		mods: [],
		size: a[6],	//	for now, width = height = size, so the source of this assignment doesn't matter
		width: a[6],
		height: a[7],
		text: "",
		goals: [],
		toBin: a
	};
	var d = new TextDecoder;
	//	uint8_t version_major; uint8_t version_minor;
	if (((a[4] << 8) + a[5]) > (VERSION_MAJOR << 8) + VERSION_MINOR)
		b.comments += " || Warning: board version " + String(a[4]) + "." + String(a[5])
				+ " is newer than viewer v" + String(VERSION_MAJOR) + "." + String(VERSION_MINOR)
				+ "; some goals or features may be unsupported.";
	//	uint8_t character;
	b.character = (a[8] == 0) ? "Any" : Object.values(BingoEnum_CharToDisplayText)[a[8] - 1];
	b.text += (a[8] == 0) ? "Any" : Object.keys(BingoEnum_CharToDisplayText)[a[8] - 1];
	b.text += ";";
	//	uint16_t shelter;
	var ptr = readShort(a, 9);
	if (ptr > 0)
		b.shelter = d.decode(a.subarray(ptr, a.indexOf(0, ptr)));
	//	uint32_t perks;
	b.perks = readLong(a, 11);
	//	uint16_t mods;
	ptr = readShort(a, 17);
	if (ptr > 0)
		b.mods = readMods(a, ptr);
	//	uint16_t reserved;
	if (readShort(a, 19) != 0)
		throw new TypeError("binToString: reserved: 0x" + readShort(a, 19).toString(16) + ", expected: 0x0");
	//	(21) uint8_t[] comments;
	b.comments = d.decode(a.subarray(HEADER_LENGTH, a.indexOf(0, HEADER_LENGTH)));

	//	uint16_t goals;
	ptr = readShort(a, 15);
	var goal, type, desc;
	for (var i = 0; i < b.width * b.height && ptr < a.length; i++) {
		try {
			goal = binGoalToText(a.subarray(ptr, ptr + a[ptr + 2] + GOAL_LENGTH));
		} catch (er) {
			goal = "BingoChallenge~Error: " + er.message + "><";
		}
		ptr += GOAL_LENGTH + a[ptr + 2];
		//[type, desc] = goal.split("~");
		//desc = desc.split(/></);
		//board.goals.push(CHALLENGES[type](desc));
		b.text += goal + "bChG";
	}
	b.text = b.text.replace(/bChG$/, "");

	return b;

	function readMods(c, offs) {
		return [];
	}

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
function binGoalToText(c) {
	var s, p, j, k, outputs, stringtype, maxIdx, replacer, tmp;
	var d = new TextDecoder;

	if (c[0] >= BINARY_TO_STRING_DEFINITIONS.length)
		throw new TypeError("binGoalToText: unknown challenge type " + String(c[0]));
	//	ignore flags, not supported in 0.85 text
	//c[1]
	s = BINARY_TO_STRING_DEFINITIONS[c[0]].desc;
	p = BINARY_TO_STRING_DEFINITIONS[c[0]].params;
	//	extract parameters and make replacements in s
	for (j = 0; j < p.length; j++) {
		stringtype = false;

		if (p[j].type == "number") {
			//	Plain number: writes a decimal integer into its replacement template site(s)
			outputs = [0];
			for (k = 0; k < p[j].size; k++) {
				//	little-endian, variable byte length, unsigned integer
				outputs[0] += c[GOAL_LENGTH + p[j].offset + k] << (8 * k);
			}

		} else if (p[j].type == "bool") {
			//	Boolean: reads one bit at the specified offset and position
			//	Note: offset includes goal's hidden flag for better packing when few flags are needed
			outputs = [(c[1 + p[j].offset] >> p[j].bit) & 0x01];
			if (p[j].formatter != "")
				outputs[0]++;	//	hack for formatter offset below

		} else if (p[j].type == "string") {
			//	Plain string: copies a fixed-length or ASCIIZ string into its replacement template site(s)
			stringtype = true;
			if (p[j].size == 0) {
				maxIdx = c.indexOf(0, GOAL_LENGTH + p[j].offset);
				if (maxIdx == -1)
					maxIdx = c.length;
			} else
				maxIdx = p[j].size + GOAL_LENGTH + p[j].offset;
			outputs = c.subarray(GOAL_LENGTH + p[j].offset, maxIdx);

		} else if (p[j].type == "pstr") {
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

		if (stringtype && p[j].formatter == "") {
			//	Unformatted string, decode bytes into utf-8
			replacer = d.decode(outputs);
		} else if (!stringtype && p[j].formatter == "") {
			//	single number, toString it
			replacer = String(outputs[0]);
		} else {
			//	Formatted number/array, convert it and join
			if (ALL_ENUMS[p[j].formatter] === undefined)
				throw new TypeError("binGoalToText: formatter \"" + p[j].formatter + "\" not found");
			tmp = [];
			for (k = 0; k < outputs.length; k++) {
				if (ALL_ENUMS[p[j].formatter][outputs[k] - 1] === undefined)
					throw new TypeError("binGoalToText: formatter \"" + p[j].formatter + "\", value out of range: " + String(outputs[k]));
				tmp.push(ALL_ENUMS[p[j].formatter][outputs[k] - 1]);
			}
			replacer = tmp.join(p[j].joiner || "");
		}
		s = s.replace(RegExp("\\{" + String(j) + "\\}", "g"), replacer);
	}
	s = BINARY_TO_STRING_DEFINITIONS[c[0]].name + "~" + s;
	return s;
}

/**
 *	Challenge classes from Bingomod decomp.
 *	Used by parseText().
 *	Note: `board` header properties have been set, and can be read at this point.
 *
 *	Adding new challenges:
 *	Append at the bottom. Yeah, they're not going to be alphabetical order anymore.
 *	Order is used by challengeValue, and thus translate names to binary identifier;
 *	to minimize changes in binary format, preserve existing ordering when possible.
 *	Modifying existing challenges:
 *	If possible, preserve compatibility between formats, auto-detect differences
 *	where possible, or use board.version to select method when not.
 */
const CHALLENGES = {
	BingoChallenge: function(desc) {
		const thisname = "BingoChallenge";
		//	Keep as template and default; behavior is as a zero-terminated string container
		desc[0] = desc[0].substring(0, 255);
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b = b.concat(new TextEncoder().encode(desc[0]));
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Empty challenge class",
			items: [],	/**< items and values arrays must have equal length */
			values: [],
			description: desc[0],	/**< HTML allowed (for other than base name == "BingoChallenge" objects) */
			comments: "",	/**< HTML allowed */
			paint: [
				{ type: "text", value: "∅", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoAchievementChallenge: function(desc) {
		const thisname = "BingoAchievementChallenge";
		//	assert: desc of format ["System.String|Traveller|Passage|0|passage", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Passage", , "passage"], "goal selection");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "passage");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Obtaining Passages",
			items: ["Passage"],
			values: [items[1]],
			description: "Earn " + (passageToDisplayNameMap[items[1]] || "unknown") + " passage.",
			comments: "",
			paint: [
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: items[1] + "A", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoAllRegionsExcept: function(desc) {
		const thisname = "BingoAllRegionsExcept";
		//	desc of format ["System.String|UW|Region|0|regionsreal", "SU|HI|DS|CC|GW|SH|VS|LM|SI|LF|UW|SS|SB|LC", "0", "13", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "region selection");
		var r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r == "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var amt = parseInt(desc[2]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + desc[2] + "\" not a number or out of range");
		var amt2 = parseInt(desc[3]);
		if (isNaN(amt2)) {
			//	0.85: desc[3] is just a number; 0.90: uses SettingBox, try parsing it that way
			var amounts = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "amount");
			amt2 = parseInt(amounts[1]); desc[3] = amounts[1];
		}
		amt2 = Math.min(amt2, amt + CHAR_MAX);
		if (isNaN(amt2) || amt2 < 0 || amt2 > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + desc[3] + "\" not a number or SettingBox, or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[4] = amt2 - amt;
		desc[1].split("|").forEach(s => b.push(enumToValue(s, "regionsreal")) );
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Entering regions while never visiting one",
			items: [items[2], "To do", "Progress", "Total"],
			values: [items[1], desc[1], String(amt), String(amt2)],
			description: "Enter " + String(amt2 - amt) + " regions that are not " + r + ".",
			comments: "This challenge is potentially quite customizable; only regions in the list need to be entered. Normally, the list is populated with all campaign story regions (i.e. corresponding Wanderer pips), so that progress can be checked on the sheltering screen. All that matters towards completion, is Progress equaling Total; thus we can set a lower bar and play a \"The Wanderer\"lite; or we could set a specific collection of regions to enter, to entice players towards them. Downside: the latter functionality is not currently supported in-game, so the region list is something of a mystery unless viewed and manually tracked.",
			paint: [
				{ type: "icon", value: "TravellerA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_red), rotation: 0 },
				{ type: "text", value: items[1], color: colorFloatToString(RainWorldColors.Unity_white) },
				{ type: "break" },
				{ type: "text", value: "[" + String(amt) + "/" + String(amt2) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoBombTollChallenge: function(desc) {
		const thisname = "BingoBombTollChallenge";
		//	desc of format ["System.String|gw_c05|Scavenger Toll|1|tolls", "System.Boolean|false|Pass the Toll|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Scavenger Toll", , "tolls"], "toll selection");
		if (!BingoEnum_BombableOutposts.includes(items[1]))
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_BombableOutposts[]");
		var pass = checkSettingbox(thisname, desc[1], ["System.Boolean", , "Pass the Toll", , "NULL"], "pass toll flag");
		if (pass[1] != "true" && pass[1] != "false")
			throw new TypeError(thisname + ": error, pass toll flag \"" + speci[1] + "\" not 'true' or 'false'");
		var regi = regionOfRoom(items[1]).toUpperCase();
		var r = (regionCodeToDisplayName[regi] || "") + " / " + (regionCodeToDisplayNameSaint[regi] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r == "")
			throw new TypeError(thisname + ": error, region \"" + regi + "\" not found in regionCodeToDisplayName[]");
		if (items[1] == "gw_c11")
			r += " underground";
		if (items[1] == "gw_c05")
			r += " surface";
		var p = [
			{ type: "icon", value: "Symbol_StunBomb", scale: 1, color: colorFloatToString(itemNameToIconColorMap["ScavengerBomb"]), rotation: 0 },
			{ type: "icon", value: "scavtoll", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
			{ type: "break" },
			{ type: "text", value: items[1].toUpperCase(), color: colorFloatToString(RainWorldColors.Unity_white) }
		];
		if (pass[1] == "true")
			p.splice(2, 0, { type: "icon", value: "singlearrow", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, pass[1]);
		b[3] = enumToValue(items[1], "tolls");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Throwing grenades at Scavenger tolls",
			items: [items[2], pass[2]],
			values: [items[1], pass[1]],
			description: "Throw a grenade at the " + r + " Scavenger toll" + ((pass[1] == "true") ? ", then pass it." : "."),
			comments: "Bomb and pass must be done in that order, in the same cycle." + getMapLink(items[1].toUpperCase()),
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoCollectPearlChallenge: function(desc) {
		const thisname = "BingoCollectPearlChallenge";
		//	desc of format ["System.Boolean|true|Specific Pearl|0|NULL", "System.String|LF_bottom|Pearl|1|pearls", "0", "System.Int32|1|Amount|3|NULL", "0", "0", ""]
		checkDescriptors(thisname, desc.length, 7, "parameter item count");
		var speci = checkSettingbox(thisname, desc[0], ["System.Boolean", , "Specific Pearl", , "NULL"], "specific pearl flag");
		if (speci[1] != "true" && speci[1] != "false")
			throw new TypeError(thisname + ": error, starving flag \"" + speci[1] + "\" not 'true' or 'false'");
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "Pearl", , "pearls"], "pearl selection");
		if (!DataPearlList.includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in DataPearlList[]");
		}
		if (dataPearlToDisplayTextMap[items[1]] === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in dataPearlToDisplayTextMap[]");
		var amounts = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		var p;
		if (speci[1] == "true") {
			var r;
			if (items[1] == "MS")
				r = "Old " + regionCodeToDisplayName["GW"];
			else {
				var regi = dataPearlToRegionMap[items[1]];
				if (regi === undefined)
					throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in dataPearlToRegionMap[]");
				r = regionCodeToDisplayName[regi];
				if (r === undefined)
					throw new TypeError(thisname + ": error, region \"" + regi + "\" not found in regionCodeToDisplayName[]");
				if (items[1] == "DM")
					r = regionCodeToDisplayName["DM"] + " / " + r;
			}
			d = "Collect the " + dataPearlToDisplayTextMap[items[1]] + " pearl from " + r + ".";
			p = [
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: colorFloatToString(dataPearlToColorMap[items[1]]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: items[1], color: colorFloatToString(RainWorldColors.Unity_white) },
				{ type: "break" },
				{ type: "text", value: "[0/1]", color: colorFloatToString(RainWorldColors.Unity_white) }
			];
		} else {
			d = "Collect " + creatureNameQuantify(amt, "colored pearls") + ".";
			p = [
				{ type: "icon", value: "pearlhoard_color", scale: 1, color: colorFloatToString(itemNameToIconColorMap["Pearl"]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			];
		}
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, speci[1]);
		b[3] = enumToValue(items[1], "pearls");
		applyShort(b, 4, amt);
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
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Item to Craft", , "craft"], "item selection");
		if (!BingoEnum_CraftableItems.includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_CraftableItems[]");
		}
		var d = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
		if (d === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in creature- or itemNameToDisplayTextMap[]");
		var amounts = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		var iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
		var iconColor = colorFloatToString(creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"]);
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "craft");
		applyShort(b, 4, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Crafting items",
			items: [items[2], amounts[2]],
			values: [items[1], amounts[1]],
			description: "Craft " + creatureNameQuantify(amt, d) + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "crafticon", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoCreatureGateChallenge: function(desc) {
		const thisname = "BingoCreatureGateChallenge";
		//	desc of format ["System.String|CicadaA|Creature Type|1|transport", "0", "System.Int32|4|Amount|0|NULL", "empty", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Creature Type", , "transport"], "creature selection");
		if (!BingoEnum_Transportable.includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_Transportable[]");
		}
		var amounts = checkSettingbox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "amount selection");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		if (creatureNameToDisplayTextMap[items[1]] === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in creature- or itemNameToDisplayTextMap[]");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "transport");
		b[4] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Transporting the same creature through gates",
			items: [items[2], amounts[2], "Dictionary"],
			values: [items[1], amounts[1], desc[3]],
			description: "Transport " + creatureNameQuantify(1, creatureNameToDisplayTextMap[items[1]]) + " through " + String(amt) + " gate" + ((amt > 1) ? "s." : "."),
			comments: "When a creature is taken through a gate, its ID is logged, and its gate-crossing count is incremented. When any logged creature meets the gate count, credit is awarded.",
			paint: [
				{ type: "icon", value: creatureNameToIconAtlasMap[items[1]], scale: 1, color: creatureToColor(items[1]), rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "ShortcutGate", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoCycleScoreChallenge: function(desc) {
		const thisname = "BingoCycleScoreChallenge";
		//	desc of format ["System.Int32|126|Target Score|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.Int32", , "Target Score", , "NULL"], "score goal");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Scoring cycle points",
			items: [items[2]],
			values: [String(amt)],
			description: "Earn " + String(amt) + " points from creature kills in a single cycle.",
			comments: "",
			paint: [
				{ type: "icon", value: "Multiplayer_Star", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "cycle_limit", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDamageChallenge: function(desc) {
		const thisname = "BingoDamageChallenge";
		//	desc of format ["System.String|JellyFish|Weapon|0|weapons", "System.String|WhiteLizard|Creature Type|1|creatures", "0", "System.Int32|6|Amount|2|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Weapon", , "weapons"], "weapon choice"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[1], ["System.String", , "Creature Type", , "creatures"], "creature choice"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "hit amount"); v.push(items[1]); i.push(items[2]);
		var amt = parseInt(v[2]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[2] + "\" not a number or out of range");
		if (!BingoEnum_Weapons.includes(v[0]))
			throw new TypeError(thisname + ": error, item selection \"" + v[0] + "\" not found in BingoEnum_Weapons[]");
		var p = [
			{ type: "icon", value: "bingoimpact", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
			{ type: "break" },
			{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
		];
		var d = "Hit ";
		if (v[1] != "Any Creature") {
			if (creatureNameToDisplayTextMap[v[1]] === undefined)
				throw new TypeError(thisname + ": error, creature type \"" + v[1] + "\" not found in creatureNameToDisplayTextMap[]");
			p.splice(1, 0, { type: "icon", value: creatureNameToIconAtlasMap[v[1]], scale: 1, color: creatureToColor(v[1]), rotation: 0 } );
		}
		d += (creatureNameToDisplayTextMap[v[1]] || v[1]) + " with ";
		if (v[0] != "Any Weapon") {
			if (itemNameToDisplayTextMap[v[0]] === undefined)
				throw new TypeError(thisname + ": error, item type \"" + v[0] + "\" not found in itemNameToDisplayTextMap[]");
			p.unshift( { type: "icon", value: itemNameToIconAtlasMap[v[0]], scale: 1, color: itemToColor(v[0]), rotation: 0 } );
		}
		d += itemNameToDisplayTextMap[v[0]] || v[0];
		var b = Array(7); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(v[0], "weapons");
		b[4] = enumToValue(v[1], "creatures");
		applyShort(b, 5, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hitting creatures with items",
			items: i,
			values: v,
			description: d + " " + String(amt) + ((amt > 1) ? " times." : " time."),
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoDepthsChallenge: function(desc) {
		const thisname = "BingoDepthsChallenge";
		//	desc of format ["System.String|VultureGrub|Creature Type|0|depths", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Creature Type", , "depths"], "creature selection");
		if (!BingoEnum_Depthable.includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_Depthable[]");
		}
		var iconName = creatureNameToIconAtlasMap[items[1]];
		var iconColor = colorFloatToString(creatureNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"]);
		var d = creatureNameToDisplayTextMap[items[1]];
		if (d === undefined || iconName === undefined || iconColor === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in creatureNameToDisplayTextMap[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "depths");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dropping a creature in the depth pit",
			items: [items[2]],
			values: [items[1]],
			description: "Drop a " + d + " into the Depths drop room (SB_D06).",
			comments: "Player, and creature of target type, must be in the room at the same time, and the creature's position must be below the drop." + getMapLink("SB_D06"),
			paint: [
				{ type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 },
				{ type: "icon", value: "deathpiticon", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "SB_D06", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDodgeLeviathanChallenge: function(desc) {
		const thisname = "BingoDodgeLeviathanChallenge";
		//	desc of format ["0", "0"]
		checkDescriptors(thisname, desc.length, 2, "parameter item count");
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Dodging a Leviathan",
			items: [],
			values: [],
			description: "Dodge a Leviathan's bite",
			comments: "Being in close proximity to a Leviathan, as it's winding up a bite, will activate this goal. (A more direct/literal interpretation&mdash;having to have been physically inside its maw, then surviving after it slams shut&mdash;was found... too challenging by playtesters.)",
			paint: [
				{ type: "icon", value: "leviathan_dodge", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoDontUseItemChallenge: function(desc) {
		const thisname = "BingoDontUseItemChallenge";
		//	desc of format ["System.String|BubbleGrass|Item type|0|banitem", "0", "0", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Item type", , "banitem"], "item selection");
		if (!ALL_ENUMS["banitem"].includes(items[1])) {
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in BingoEnum_banitem[]");
		}
		var iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
		var iconColor = colorFloatToString(creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"]);
		var d = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
		if (d === undefined)
			throw new TypeError(thisname + ": error, item \"" + items[1] + "\" not found in creature- or itemNameToDisplayTextMap[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, String(desc[1] == "1"));
		applyBool(b, 1, 5, String(desc[4] == "1"));
		b[3] = enumToValue(items[1], "banitem");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding items",
			items: [items[2], "isFood", "isCreature"],
			values: [items[2], desc[1] == "1", desc[4] == "1"],
			description: "Never " + ((desc[1] == "1") ? "eat" : "use") + " " + d + ".",
			comments: "\"Using\" an item involves throwing a throwable item, eating a food item, or holding any other type of item for 5 seconds.",
			paint: [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_red), rotation: 0 },
				{ type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoEatChallenge: function(desc) {
		const thisname = "BingoEatChallenge";
		//	desc of format ["System.Int32|6|Amount|1|NULL", "0", "0", "System.String|DangleFruit|Food type|0|food", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var amounts = checkSettingbox(thisname, desc[0], ["System.Int32", , "Amount", , "NULL"], "eat amount");
		var amt = parseInt(amounts[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		var items = checkSettingbox(thisname, desc[3], ["System.String", , "Food type", , "food"], "eat type");
		if (!BingoEnum_FoodTypes.includes(items[1]))
			throw new TypeError(thisname + ": error, item selection \"" + items[1] + "\" not found in BingoEnum_FoodTypes[]");
		var iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
		var iconColor = colorFloatToString(creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"]);
		var d = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		applyBool(b, 1, 4, String(desc[2] == "1"));
		b[5] = enumToValue(items[1], "food");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Eating specific food",
			items: [amounts[2], items[2]],
			values: [amounts[1], items[1]],
			description: "Eat " + creatureNameQuantify(amt, d) + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: iconName, scale: 1, color: iconColor, rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoEchoChallenge: function(desc) {
		const thisname = "BingoEchoChallenge";
		//	desc of format ["System.String|SB|Region|0|echoes", "System.Boolean|false|While Starving|1|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var echor = checkSettingbox(thisname, desc[0], ["System.String", , "Region", , "echoes"], "echo region");
		var r = (regionCodeToDisplayName[echor[1]] || "") + " / " + (regionCodeToDisplayNameSaint[echor[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r == "")
			throw new TypeError(thisname + ": error, region \"" + echor[1] + "\" not found in regionCodeToDisplayName[]");
		items = checkSettingbox(thisname, desc[1], ["System.Boolean", , "While Starving", , "NULL"], "starving flag");
		if (items[1] != "true" && items[1] != "false")
			throw new TypeError(thisname + ": error, starving flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [
			{ type: "icon", value: "echo_icon", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
			{ type: "text", value: echor[1], color: colorFloatToString(RainWorldColors.Unity_white) }
		];
		if (items[1] == "true") {
			p.push( { type: "break" } );
			p.push( { type: "icon", value: "Multiplayer_Death", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
		}
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, items[1]);
		b[3] = enumToValue(echor[1], "echoes");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Visiting echoes",
			items: [echor[2], items[2]],
			values: [echor[1], items[1]],
			description: "Visit the " + r + " Echo" + ((items[1] == "true") ? ", while starving." : "."),
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoEnterRegionChallenge: function(desc) {
		const thisname = "BingoEnterRegionChallenge";
		//	desc of format ["System.String|CC|Region|0|regionsreal", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "enter region");
		var r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r == "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Entering a region",
			items: [items[2]],
			values: [items[1]],
			description: "Enter " + r + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "keyShiftA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_green), rotation: 90 },
				{ type: "text", value: items[1], color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoGlobalScoreChallenge: function(desc) {
		const thisname = "BingoGlobalScoreChallenge";
		//	desc of format ["0", "System.Int32|271|Target Score|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Target Score", , "NULL"], "score goal");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Scoring global points",
			items: [items[2]],
			values: [String(amt)],
			description: "Earn " + amt + " points from creature kills.",
			comments: "",
			paint: [
				{ type: "icon", value: "Multiplayer_Star", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoGreenNeuronChallenge: function(desc) {
		const thisname = "BingoGreenNeuronChallenge";
		//	desc of format ["System.Boolean|true|Looks to the Moon|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		items = checkSettingbox(thisname, desc[0], ["System.Boolean", , "Looks to the Moon", , "NULL"], "iterator choice flag");
		if (items[1] != "true" && items[1] != "false")
			throw new TypeError(thisname + ": error, iterator choice flag \"" + items[1] + "\" not 'true' or 'false'");
		var d;
		var p = [
			{ type: "icon", value: "GuidanceNeuron", scale: 1, color: colorFloatToString(RainWorldColors["GuidanceNeuron"]), rotation: 0 },
			{ type: "icon", value: "singlearrow", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
		]
		if (items[1] == "true") {
			d = "Reactivate Looks to the Moon.";
			p.push( { type: "icon", value: "GuidanceMoon", scale: 1, color: colorFloatToString(RainWorldColors["GuidanceMoon"]), rotation: 0 } );
		} else {
			d = "Deliver the green neuron to Five Pebbles.";
			p.push( { type: "icon", value: "nomscpebble", scale: 1, color: colorFloatToString(RainWorldColors["nomscpebble"]), rotation: 0 } );
		}
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, items[1]);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering the green neuron",
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
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var amounts = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "egg count");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 0)
			throw new TypeError(thisname + ": error, amount \"" + amounts[1] + "\" not a number or out of range");
		items = checkSettingbox(thisname, desc[2], ["System.Boolean", , "At Once", , "NULL"], "one-cycle flag");
		if (items[1] != "true" && items[1] != "false")
			throw new TypeError(thisname + ": error, one-cycle flag \"" + items[1] + "\" not 'true' or 'false'");
		var p = [
			{ type: "icon", value: itemNameToIconAtlasMap["NeedleEgg"], scale: 1, color: colorFloatToString(itemNameToIconColorMap["NeedleEgg"]), rotation: 0 },
			{ type: "icon", value: creatureNameToIconAtlasMap["SmallNeedleWorm"], scale: 1, color: creatureToColor("SmallNeedleWorm"), rotation: 0 },
			{ type: "break" },
			{ type: "text", value: "[0/" + amt + "]", color: colorFloatToString(RainWorldColors.Unity_white) },
		];
		if (items[1] == "true")
			p.splice(2, 0, { type: "icon", value: "cycle_limit", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = amt;
		applyBool(b, 1, 4, items[1]);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hatching noodlefly eggs",
			items: [amounts[2], items[2]],
			values: [amounts[1], items[1]],
			description: "Hatch " + creatureNameQuantify(amt, itemNameToDisplayTextMap["NeedleEgg"]) + ((items[1] == "true") ? " in one cycle." : "."),
			comments: "Eggs must be hatched where the player is sheltering. Eggs stored in other shelters disappear and do not give credit towards this goal.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoHellChallenge: function(desc) {
		const thisname = "BingoHellChallenge";
		//	desc of format ["0", "System.Int32|2|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "goal count");
		var amt = parseInt(items[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 0)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = amt;
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Not dying before completing challenges",
			items: [items[2]],
			values: [String(amt)],
			description: "Do not die before completing " + creatureNameQuantify(amt, "bingo challenges") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "completechallenge", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "text", value: "[0/" + amt + "]", color: colorFloatToString(RainWorldColors.Unity_white) },
				{ type: "break" },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_red), rotation: 0 },
				{ type: "icon", value: "Multiplayer_Death", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoItemHoardChallenge: function(desc) {
		const thisname = "BingoItemHoardChallenge";
		//	desc of format ["System.Int32|5|Amount|1|NULL", "System.String|PuffBall|Item|0|expobject", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var amounts = checkSettingbox(thisname, desc[0], ["System.Int32", , "Amount", , "NULL"], "item count");
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "Item", , "expobject"], "item selection");
		if (!BingoEnum_expobject.includes(items[1]))
			throw new TypeError(thisname + ": error, item selection \"" + items[1] + "\" not found in BingoEnum_expobject[]");
		var amt = parseInt(amounts[1]);
		amt = Math.min(amt, CHAR_MAX);
		if (isNaN(amt) || amt < 0)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = amt;
		b[4] = enumToValue(items[1], "expobject");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hoarding items in shelters",
			items: [amounts[2], items[2]],
			values: [String(amt), items[1]],
			description: "Store " + creatureNameQuantify(amt, itemNameToDisplayTextMap[items[1]]) + " in " + ((amt == 1) ? "a" : "the same") + " shelter.",
			comments: "",
			paint: [
				{ type: "icon", value: "ShelterMarker", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: itemNameToIconAtlasMap[items[1]], scale: 1, color: itemToColor(items[1]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoKarmaFlowerChallenge: function(desc) {
		const thisname = "BingoKarmaFlowerChallenge";
		//	assert: desc of format ["0", "System.Int32|5|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "item count");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Consuming Karma Flowers",
			items: [items[2]],
			values: [String(amt)],
			description: "Consume " + creatureNameQuantify(amt, "Karma Flowers") + ".",
			comments: "With this goal present on the board, flowers are spawned in the world in their normal locations. The player obtains the benefit of consuming the flower (protecting karma level). While the goal is in progress, players <em>do not drop</em> the flower on death. After the goal is completed or locked, a flower can drop on death as normal.",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "FlowerMarker", scale: 1, color: colorFloatToString(RainWorldColors.SaturatedGold), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + items[1] + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoKillChallenge: function(desc) {
		const thisname = "BingoKillChallenge";
		//	assert: desc of format ["System.String|Scavenger|Creature Type|0|creatures",
		//	"System.String|Any Weapon|Weapon Used|6|weaponsnojelly", "System.Int32|5|Amount|1|NULL", "0",
		//	"System.String|Any Region|Region|5|regions", "System.String|Any Subregion|Subregion|4|subregions",
		//	"System.Boolean|false|In one Cycle|3|NULL", "System.Boolean|false|Via a Death Pit|7|NULL",
		//	"System.Boolean|false|While Starving|2|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 11, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Creature Type", , "creatures"], "target selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[1], ["System.String", , "Weapon Used", , "weaponsnojelly"], "weapon selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[2], ["System.Int32", , "Amount", , "NULL"], "kill count"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[5], ["System.String", , "Subregion", , "subregions"], "subregion selection"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[6], ["System.Boolean", , "In one Cycle", , "NULL"], "one-cycle flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[7], ["System.Boolean", , "Via a Death Pit", , "NULL"], "death pit flag"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[8], ["System.Boolean", , "While Starving", , "NULL"], "starving flag"); v.push(items[1]); i.push(items[2]);
		var r = "";
		var amt = parseInt(v[2]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[2] + "\" not a number or out of range");
		var c = String(amt) + " creatures";
		if (v[0] != "Any Creature") {
			if (creatureNameToDisplayTextMap[v[0]] === undefined)
				throw new TypeError(thisname + ": error, creature type \"" + v[0] + "\" not found in creatureNameToDisplayTextMap[]");
			c = creatureNameQuantify(amt, creatureNameToDisplayTextMap[v[0]]);
		}
		if (v[3] != "Any Region") {
			r = (regionCodeToDisplayName[v[3]] || "") + " / " + (regionCodeToDisplayNameSaint[v[3]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r == "")
				throw new TypeError(thisname + ": error, region selection \"" + v[3] + "\" not found in regionCodeToDisplayName[]");
			r = " in " + r;
		}
		if (v[4] != "Any Subregion") {
			r = " in " + v[4];
			if (BingoEnum_AllSubregions[v[4]] === undefined)
				throw new TypeError(thisname + ": error, subregion selection \"" + v[4] + "\" not found in BingoEnum_AllSubregions[]");
		}
		var w = ", with a death pit";
		if (!BingoEnum_Weapons.includes(v[1]))
			throw new TypeError(thisname + ": error, weapon selection \"" + v[1] + "\" not found in BingoEnum_Weapons[]");
		if (v[6] == "false") {
			if (v[1] != "Any Weapon") {
				w = " with " + itemNameToDisplayTextMap[v[1]];
			} else {
				w = "";
			}
		}
		var p = [];
		if (v[1] != "Any Weapon" || v[6] == "true") {
			if (v[6] == "true")
				p.push( { type: "icon", value: "deathpiticon", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
			else
				p.push( { type: "icon", value: itemNameToIconAtlasMap[v[1]], scale: 1, color: itemToColor(v[1]), rotation: 0 } );
		}
		if (v[5] != "true" && v[5] != "false")
			throw new TypeError(thisname + ": error, one-cycle flag \"" + v[5] + "\" not 'true' or 'false'");
		if (v[6] != "true" && v[6] != "false")
			throw new TypeError(thisname + ": error, death pit flag \"" + v[6] + "\" not 'true' or 'false'");
		if (v[7] != "true" && v[7] != "false")
			throw new TypeError(thisname + ": error, starving flag \"" + v[7] + "\" not 'true' or 'false'");
		p.push( { type: "icon", value: "Multiplayer_Bones", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
		if (v[0] != "Any Creature") {
			p.push( { type: "icon", value: creatureNameToIconAtlasMap[v[0]], scale: 1,
					color: creatureToColor(v[0]), rotation: 0 } );
		}
		p.push( { type: "break" } );
		if (v[4] == "Any Subregion") {
			if (v[3] != "Any Region") {
				p.push( { type: "text", value: v[3], color: colorFloatToString(RainWorldColors.Unity_white) } );
				p.push( { type: "break" } );
			}
		} else {
			p.push( { type: "text", value: v[4], color: colorFloatToString(RainWorldColors.Unity_white) } );
			p.push( { type: "break" } );
		}
		p.push( { type: "text", value: "[0/" + v[2] + "]", color: colorFloatToString(RainWorldColors.Unity_white) } );
		if (v[7] == "true")
			p.push( { type: "icon", value: "Multiplayer_Death", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
		if (v[5] == "true")
			p.push( { type: "icon", value: "cycle_limit", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
		var b = Array(9); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, v[5]);
		applyBool(b, 1, 5, v[6]);
		applyBool(b, 1, 6, v[7]);
		b[3] = enumToValue(v[0], "creatures");
		b[4] = enumToValue(v[1], "weaponsnojelly");
		applyShort(b, 5, amt);
		b[7] = enumToValue(v[3], "regions");
		b[8] = enumToValue(v[4], "subregions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Killing creatures",
			items: i,
			values: v,
			description: "Kill " + c + r + w
					+ ((v[7] == "true") ? ", while starving" : "")
					+ ((v[5] == "true") ? ", in one cycle"   : "") + ".",
			comments: "(If defined, subregion takes precedence over region. If set, Death Pit takes precedence over weapon selection.)<br>Credit is determined by the last source of 'blame' at time of death. For creatures that take multiple hits, try to \"soften them up\" with more common items, before using limited ammunition to deliver the killing blow.  Creatures that \"bleed out\", can be mortally wounded (brought to or below 0 HP), before being tagged with a specific weapon to obtain credit. Starving: must be in the \"malnourished\" state; this state is cleared after eating to full.",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoMaulTypesChallenge: function(desc) {
		const thisname = "BingoMaulTypesChallenge";
		//	desc of format "0", "System.Int32|4|Amount|0|NULL", "0", "0", ""
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "maul amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt >= ALL_ENUMS["creatures"].length)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
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
				{ type: "icon", value: "artimaulcrit", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoMaulXChallenge: function(desc) {
		const thisname = "BingoMaulXChallenge";
		//	desc of format ["0", "System.Int32|13|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "maul amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Mauling creatures a certain amount of times",
			items: ["Amount"],
			values: [String(amt)],
			description: "Maul creatures " + String(amt) + " times.",
			comments: "",
			paint: [
				{ type: "icon", value: "artimaul", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNeuronDeliveryChallenge: function(desc) {
		const thisname = "BingoNeuronDeliveryChallenge";
		//	desc of format ["System.Int32|2|Amount of Neurons|0|NULL", "0", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.Int32", , "Amount of Neurons", , "NULL"], "neuron amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Gifting neurons",
			items: ["Amount"],
			values: [String(amt)],
			description: "Deliver " + creatureNameQuantify(amt, "Neurons") + " to Looks to the Moon.",
			comments: "",
			paint: [
				{ type: "icon", value: "Symbol_Neuron", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "GuidanceMoon", scale: 1, color: colorFloatToString(RainWorldColors["GuidanceMoon"]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNoNeedleTradingChallenge: function(desc) {
		const thisname = "BingoNoNeedleTradingChallenge";
		//	desc of format ["0", "0"]
		checkDescriptors(thisname, desc.length, 2, "parameter item count");
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding gifting Needles to Scavengers",
			items: [],
			values: [],
			description: "Do not gift Needles to Scavengers.",
			comments: "",
			paint: [
				{ type: "icon", value: "spearneedle", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "commerce", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "Kill_Scavenger", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "buttonCrossA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_red), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoNoRegionChallenge: function(desc) {
		const thisname = "BingoNoRegionChallenge";
		//	desc of format ["System.String|SI|Region|0|regionsreal", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Region", , "regionsreal"], "avoid region");
		var r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r == "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Avoiding a region",
			items: [items[2]],
			values: [items[1]],
			description: "Do not enter " + r + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "buttonCrossA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_red), rotation: 0 },
				{ type: "text", value: items[1], color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPearlDeliveryChallenge: function(desc) {
		const thisname = "BingoPearlDeliveryChallenge";
		//	desc of format ["System.String|LF|Pearl from Region|0|regions", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Pearl from Region", , "regions"], "pearl region");
		var r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r = r.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r == "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering colored pearls to an Iterator",
			items: [items[2]],
			values: [items[1]],
			description: "Deliver " + r + " colored pearl to Looks To The Moon (Artificer: Five Pebbles)",
			comments: "",
			paint: [
				{ type: "text", value: items[1], color: colorFloatToString(RainWorldColors.Unity_white) },
				{ type: "icon", value: "Symbol_Pearl", scale: 1, color: colorFloatToString(itemNameToIconColorMap["Pearl"]), rotation: 0 },
				{ type: "break" },
				{ type: "icon", value: "singlearrow", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 90 },
				{ type: "break" },
/*				{ type: "icon", value: "nomscpebble", scale: 1, color: colorFloatToString(RainWorldColors["nomscpebble"]), rotation: 0 }, */
				{ type: "icon", value: "GuidanceMoon", scale: 1, color: colorFloatToString(RainWorldColors["GuidanceMoon"]), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPearlHoardChallenge: function(desc) {
		const thisname = "BingoPearlHoardChallenge";
		//	desc of format ["System.Boolean|false|Common Pearls|0|NULL", "System.Int32|2|Amount|1|NULL", "System.String|SL|In Region|2|regions", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[0], ["System.Boolean", , "Common Pearls", , "NULL"], "common pearls flag"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pearl count"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[2], ["System.String", , "In Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		if (v[0] != "true" && v[0] != "false")
			throw new TypeError(thisname + ": error, common pearls flag \"" + v[0] + "\" not 'true' or 'false'");
		var amt = parseInt(v[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[1] + "\" not a number or out of range");
		if (v[2] != "Any Region") {
			var r = (regionCodeToDisplayName[v[2]] || "") + " / " + (regionCodeToDisplayNameSaint[v[2]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r == "")
				throw new TypeError(thisname + ": error, region \"" + v[2] + "\" not found in regionCodeToDisplayName[]");
		} else
			r = "any region";
		var pearl = " common pearls";
		if (v[0] == "false") pearl = " colored pearls";
		if (amt == 1) pearl = pearl.substring(0, pearl.length - 1);
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		applyBool(b, 1, 4, v[0]);
		applyShort(b, 3, amt);
		b[5] = enumToValue(v[2], "regions");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Hoarding pearls in shelters",
			items: i,
			values: v,
			description: "Store " + String(amt) + pearl + " in a shelter in " + r + ".",
			comments: "Faded pearls (colored pearl spawns in Saint campaign) do not count towards a \"common pearls\" goal.",
			paint: [
				{ type: "icon", value: "ShelterMarker", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: ((v[0] == "true") ? "pearlhoard_normal" : "pearlhoard_color"), scale: 1, color: colorFloatToString(itemNameToIconColorMap["Pearl"]), rotation: 0 },
				{ type: "text", value: v[2], color: colorFloatToString(RainWorldColors.Unity_white) },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoPinChallenge: function(desc) {
		const thisname = "BingoPinChallenge";
		//	desc of format ["0", "System.Int32|5|Amount|0|NULL", "System.String|PinkLizard|Creature Type|1|creatures", "", "System.String|SU|Region|2|regions", "0", "0"]
		checkDescriptors(thisname, desc.length, 7, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pin amount"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[2], ["System.String", , "Creature Type", , "creatures"], "creature type"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[4], ["System.String", , "Region", , "regions"], "region selection"); v.push(items[1]); i.push(items[2]);
		var amt = parseInt(v[0]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[0] + "\" not a number or out of range");
		var c = "creatures";
		if (v[1] != "Any Creature") {
			if (creatureNameToDisplayTextMap[v[1]] === undefined)
				throw new TypeError(thisname + ": error, creature type \"" + v[1] + "\" not found in creatureNameToDisplayTextMap[]");
			c = creatureNameToDisplayTextMap[v[1]];
		}
		c = creatureNameQuantify(amt, c);
		var r = v[2];
		if (r != "Any Region") {
			r = (regionCodeToDisplayName[v[2]] || "") + " / " + (regionCodeToDisplayNameSaint[v[2]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r == "")
				throw new TypeError(thisname + ": error, region \"" + v[2] + "\" not found in regionCodeToDisplayName[]");
		} else {
			r = "different regions";
		}
		var p = [ { type: "icon", value: "pin_creature", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } ];
		if (v[1] != "Any Creature") {
			p.push( { type: "icon", value: creatureNameToIconAtlasMap[v[1]], scale: 1, color: colorFloatToString(creatureNameToIconColorMap[v[1]] || creatureNameToIconColorMap["Default"]), rotation: 0 } );
		}
		if (v[2] == "Any Region") {
			p.push( { type: "icon", value: "TravellerA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
		} else {
			p.push( { type: "text", value: v[2], color: colorFloatToString(RainWorldColors.Unity_white) } );
		}
		p.push( { type: "break" } );
		p.push( { type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) } );
		var b = Array(7); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[5] = enumToValue(v[1], "creatures");
		b[6] = enumToValue(v[2], "regions");
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
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "pop amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Popping popcorn plants",
			items: [items[2]],
			values: [String(amt)],
			description: "Open " + creatureNameQuantify(amt, "popcorn plants") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "Symbol_Spear", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "popcorn_plant", scale: 1, color: colorFloatToString(RainWorldColors["popcorn_plant"]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoRivCellChallenge: function(desc) {
		const thisname = "BingoRivCellChallenge";
		//	desc of format ["0", "0"]
		checkDescriptors(thisname, desc.length, 2, "parameter item count");
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Feeding the Rarefaction Cell to a Leviathan",
			items: [],
			values: [],
			description: "Feed the Rarefaction Cell to a Leviathan (completes if you die).",
			comments: "Truly, the Rarefaction Cell's explosion transcends time and space; hence, this goal is awarded even if the player dies in the process.",
			paint: [
				{ type: "icon", value: "Symbol_EnergyCell", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "Kill_BigEel", scale: 1, color: colorFloatToString(creatureNameToIconColorMap["BigEel"] || creatureNameToIconColorMap["Default"]), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoSaintDeliveryChallenge: function(desc) {
		const thisname = "BingoSaintDeliveryChallenge";
		//	desc of format ["0", "0"]
		checkDescriptors(thisname, desc.length, 2, "parameter item count");
		var b = Array(3); b.fill(0);
		b[0] = challengeValue(thisname);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Delivering the music pearl to Five Pebbles",
			items: [],
			values: [],
			description: "Deliver the music pearl to Five Pebbles",
			comments: "",
			paint: [
				{ type: "icon", value: "memoriespearl", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "singlearrow", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "nomscpebble", scale: 1, color: colorFloatToString(RainWorldColors["nomscpebble"]), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoSaintPopcornChallenge: function(desc) {
		const thisname = "BingoSaintPopcornChallenge";
		//	desc of format ["0", "System.Int32|7|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "seed amount");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Eating popcorn plant seeds",
			items: [items[2]],
			values: [String(amt)],
			description: "Eat " + creatureNameQuantify(amt, "popcorn plant seeds") + ".",
			comments: "",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "Symbol_Seed", scale: 1, color: colorFloatToString(itemNameToIconColorMap["Default"]), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoStealChallenge: function(desc) {
		const thisname = "BingoStealChallenge";
		//	assert: desc of format ["System.String|Rock|Item|1|theft",
		//	"System.Boolean|false|From Scavenger Toll|0|NULL",
		//	"0", "System.Int32|3|Amount|2|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var v = [], i = [];
		var p = [ { type: "icon", value: "steal_item", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } ];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Item", , "theft"], "item selection"); v.push(items[1]); i.push(items[2]);
		if (!BingoEnum_theft.includes(v[0]))
			throw new TypeError(thisname + ": error, item \"" + v[0] + "\" not found in BingoEnum_theft[]");
		items = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "item count"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[1], ["System.Boolean", , "From Scavenger Toll", , "NULL"], "venue flag"); v.push(items[1]); i.push(items[2]);
		if (itemNameToDisplayTextMap[v[0]] === undefined)
			throw new TypeError(thisname + ": error, item selection \"" + v[2] + "\" not found in itemNameToDisplayTextMap[]");
		var amt = parseInt(v[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + v[1] + "\" not a number or out of range");
		var d = "Steal " + String(amt) + " " + itemNameToDisplayTextMap[v[0]] + " from ";
		p.push( { type: "icon", value: itemNameToIconAtlasMap[v[0]], scale: 1,
				color: itemToColor(v[0]), rotation: 0 } );
		if (v[2] == "true") {
			p.push( { type: "icon", value: "scavtoll", scale: 0.8, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
			d += "a Scavenger Toll.";
		} else if (v[2] == "false") {
			p.push( { type: "icon", value: creatureNameToIconAtlasMap["Scavenger"], scale: 1,
					color: creatureToColor("Scavenger"), rotation: 0 } );
			d += "Scavengers.";
		} else {
			throw new TypeError(thisname + ": error, venue flag \"" + v[2] + "\" not 'true' or 'false'");
		}
		p.push( { type: "break" } );
		p.push( { type: "text", value: "[0/" + v[1] + "]", color: colorFloatToString(RainWorldColors.Unity_white) } );
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(v[0], "theft");
		applyBool(b, 1, 4, v[2]);
		applyShort(b, 4, amt);
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
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Creature Type", , "friend"], "creature type");
		if (!BingoEnum_Befriendable.includes(items[1]))
			throw new TypeError(thisname + ": error, creature type \"" + items[1] + "\" not Befriendable");
		var d = creatureNameToDisplayTextMap[items[1]];
		if (d === undefined)
			throw new TypeError(thisname + ": error, creature type \"" + items[1] + "\" not found in creatureNameToDisplayTextMap[]");
		d = creatureNameQuantify(1, d);
		var b = Array(4); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "friend");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Befriending a creature",
			items: ["Creature Type"],
			values: [items[1]],
			description: "Befriend " + d + ".",
			comments: "Taming occurs when a creature has been fed or rescued enough times to increase the player's reputation above some threshold, starting from a default depending on species, and the global and regional reputation of the player.<br>Feeding occurs when 1. the player drops an edible item, creature or corpse, 2. within view of the creature, and 3. the creature bites that object. \"Happy lizard noises\" indicates success. The creature does not need to den with the item to increase reputation. Stealing the object back from the creature's jaws does not reduce reputation.<br>A rescue occurs when 1. a creature sees or is grabbed by a threat, 2. the player attacks the threat (if the creatures was grabbed, the predator must be stunned enough to drop the creature), and 3. the creature sees the attack (or gets dropped because of it).",
			paint: [
				{ type: "icon", value: "FriendB", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: creatureNameToIconAtlasMap[items[1]], scale: 1,
						color: creatureToColor(items[1]), rotation: 0 }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoTradeChallenge: function(desc) {
		const thisname = "BingoTradeChallenge";
		//	desc of format ["0", "System.Int32|15|Value|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Value", , "NULL"], "points value");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Trading items to Merchants",
			items: [items[2]],
			values: [String(amt)],
			description: "Trade " + String(amt) + " points worth of items to Scavenger Merchants.",
			comments: "A trade occurs when 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. When the Scavenger is also a Merchant, points will be awarded. Any item can be traded once to award points according to its value; this includes items initially held by (then dropped or traded) by Scavengers. If an item seems to have been ignored or missed, try trading it again. Stealing and murder will not result in points being awarded.",
			paint: [
				{ type: "icon", value: "scav_merchant", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoTradeTradedChallenge: function(desc) {
		const thisname = "BingoTradeTradedChallenge";
		//	desc of format ["0", "System.Int32|3|Amount of Items|0|NULL", "empty", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount of Items", , "NULL"], "amount of items");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + items[1] + "\" not a number or out of range");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, amt);
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Trading already traded items",
			items: [items[2]],
			values: [String(amt)],
			description: "Trade " + String(amt) + ((amt == 1) ? " item" : " items") + " from Scavenger Merchants to other Scavenger Merchants.",
			comments: "A trade occurs when 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. While this challenge is active, any item dropped by a Merchant, due to a trade, will be \"blessed\" and thereafter bear a mark indicating its eligibility for this challenge. In a Merchant room, the Merchant bears a '✓' tag to show who you should trade with; other Scavengers in the room are tagged with 'X'. Stealing from or murdering a Merchant will not result in \"blessed\" items dropping (unless they were already traded). A \"blessed\" item can then be brought to any <em>other</em> Merchant and traded, to award credit.",
			paint: [
				{ type: "icon", value: "scav_merchant", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "Menu_Symbol_Shuffle", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "icon", value: "scav_merchant", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + String(amt) + "]", color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoTransportChallenge: function(desc) {
		const thisname = "BingoTransportChallenge";
		//	desc of format ["System.String|Any Region|From Region|0|regions", "System.String|DS|To Region|1|regions", "System.String|CicadaA|Creature Type|2|transport", "", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var v = [], i = [];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "From Region", , "regions"], "from region"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "To Region", , "regions"], "to region"); v.push(items[1]); i.push(items[2]);
		var items = checkSettingbox(thisname, desc[2], ["System.String", , "Creature Type", , "transport"], "transportable creature type"); v.push(items[1]); i.push(items[2]);
		var r1 = v[0], r2 = v[1];
		if (r1 != "Any Region") {
			r1 = (regionCodeToDisplayName[v[0]] || "") + " / " + (regionCodeToDisplayNameSaint[v[0]] || "");
			r1 = r1.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r1 == "")
				throw new TypeError(thisname + ": error, region \"" + v[0] + "\" not found in regionCodeToDisplayName[]");
		}
		if (r2 != "Any Region") {
			r2 = (regionCodeToDisplayName[v[1]] || "") + " / " + (regionCodeToDisplayNameSaint[v[1]] || "");
			r2 = r2.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r2 == "")
				throw new TypeError(thisname + ": error, region \"" + v[1] + "\" not found in regionCodeToDisplayName[]");
		}
		if (creatureNameToDisplayTextMap[v[2]] === undefined)
			throw new TypeError(thisname + ": error, creature type \"" + v[2] + "\" not found in creatureNameToDisplayTextMap[]");
		if (!BingoEnum_Transportable.includes(v[2]))
			throw new TypeError(thisname + ": error, creature type \"" + v[2] + "\" not Transportable");
		var p = [
			{ type: "icon", value: creatureNameToIconAtlasMap[v[2]], scale: 1, color: creatureToColor(v[2]), rotation: 0 },
			{ type: "break" }
		];
		if (p[0].value === undefined || p[0].color === undefined)
			throw new TypeError(thisname + ": error, token \"" + v[2] + "\" not found in itemNameToIconAtlasMap[] or Color");
		if (v[0] != "Any Region") p.push( { type: "text", value: v[0], color: colorFloatToString(RainWorldColors.Unity_white) } );
		p.push( { type: "icon", value: "singlearrow", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 } );
		if (v[1] != "Any Region") p.push( { type: "text", value: v[1], color: colorFloatToString(RainWorldColors.Unity_white) } );
		var b = Array(6); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(v[0], "regions");
		b[4] = enumToValue(v[1], "regions");
		b[5] = enumToValue(v[2], "transport");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Transporting creatures",
			items: i,
			values: v,
			description: "Transport " + creatureNameQuantify(1, creatureNameToDisplayTextMap[v[2]]) + " from " + r1 + " to " + r2,
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoUnlockChallenge: function(desc) {
		const thisname = "BingoUnlockChallenge";
		//	desc of format ["System.String|SingularityBomb|Unlock|0|unlocks", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Unlock", , "unlocks"], "unlock selection");
		var iconName = "", iconColor = [];
		var p = [
			{ type: "icon", value: "arenaunlock", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
			{ type: "break" }
		];
		var d = "Get the ", r;
		if (BingoEnum_ArenaUnlocksBlue.includes(items[1])) {
			p[0].color = colorFloatToString(RainWorldColors.AntiGold);
			iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
			iconColor = creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"];
			r = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
			if (iconName === undefined || r === undefined)
				throw new TypeError(thisname + ": error, token \"" + items[1] + "\" not found in itemNameToIconAtlasMap[] (or creature-, or Color or DisplayText)");
			d += r;
		} else if (BingoEnum_ArenaUnlocksGold.includes(items[1])) {
			p[0].color = colorFloatToString(RainWorldColors.TokenDefault);
			r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r == "") {
				r = arenaUnlocksGoldToDisplayName[items[1]];
				if (r === undefined)
					throw new TypeError(thisname + ": error, arena \"" + items[1] + "\" not found in arenaUnlocksGoldToDisplayName[]");
			}
			d += r + " Arenas";
		} else if (BingoEnum_ArenaUnlocksGreen.includes(items[1])) {
			p[0].color = colorFloatToString(RainWorldColors.GreenColor);
			iconName = "Kill_Slugcat";
			iconColor = RainWorldColors["Slugcat_" + items[1]];
			if (iconColor === undefined)
				throw new TypeError(thisname + ": error, token \"Slugcat_" + items[1] + "\" not found in RainWorldColors[]");
			d += items[1] + " character"
		} else if (BingoEnum_ArenaUnlocksRed.includes(items[1])) {
			p[0].color = colorFloatToString(RainWorldColors.RedColor);
			r = items[1].substring(0, items[1].search("-"));
			r = (regionCodeToDisplayName[r] || "") + " / " + (regionCodeToDisplayNameSaint[r] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r == "")
				throw new TypeError(thisname + ": error, region \"" + items[1].substring(0, items[1].search("-")) + "\" not found in regionCodeToDisplayName[]");
			d += r + " Safari";
		} else {
			throw new TypeError(thisname + ": error, token \"" + items[1] + "\" not found in BingoEnum_ArenaUnlocks[]");
		}
		if (iconName == "")
			p.push( { type: "text", value: items[1], color: colorFloatToString(RainWorldColors.Unity_white) } );
		else
			p.push( { type: "icon", value: iconName, scale: 1, color: colorFloatToString(iconColor), rotation: 0 } );
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		applyShort(b, 3, enumToValue(items[1], "unlocks"));
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Getting Arena Unlocks",
			items: ["Unlock"],
			values: [items[1]],
			description: d + " unlock.",
			comments: "",
			paint: p,
			toBin: new Uint8Array(b)
		};
	},
	BingoVistaChallenge: function(desc) {
		const thisname = "BingoVistaChallenge";
		//	desc of format ["CC", "System.String|CC_A10|Room|0|vista", "734", "506", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "Room", , "vista"], "item selection");
		//	desc[0] is region code
		if (desc[0] != regionOfRoom(items[1]))
			throw new TypeError(thisname + ": error, region \"" + desc[0] + "\" does not match room \"" + items[1] + "\"'s region");
		var v = (regionCodeToDisplayName[desc[0]] || "") + " / " + (regionCodeToDisplayNameSaint[desc[0]] || "");
		v = v.replace(/^\s\/\s|\s\/\s$/g, "");
		if (v == "")
			throw new TypeError(thisname + ": error, region \"" + desc[0] + "\" not found in regionCodeToDisplayName[]");
		var roomX = parseInt(desc[2]);
		if (isNaN(roomX) || roomX < 0 || roomX > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + desc[2] + "\" not a number or out of range");
		var roomY = parseInt(desc[3]);
		if (isNaN(roomY) || roomY < 0 || roomY > INT_MAX)
			throw new TypeError(thisname + ": error, amount \"" + desc[3] + "\" not a number or out of range");
		var idx = BingoEnum_VistaPoints.findIndex(o => o.room == items[1] && o.x == roomX && o.y == roomY);
		if (idx < 0) {
			//	Can't find in list, customize it
			var b = Array(8); b.fill(0);
			b[0] = challengeValue(thisname);
			b[3] = enumToValue(desc[0], "regions");
			applyShort(b, 4, roomX);
			applyShort(b, 6, roomY);
			b = b.concat([...new TextEncoder().encode(items[1])]);
			b[2] = b.length - GOAL_LENGTH;
		} else {
			//	Use stock list for efficiency
			var b = Array(4); b.fill(0);
			b[0] = challengeValue("BingoVistaChallenge") + 1;
			b[3] = idx + 1;
			b[2] = b.length - GOAL_LENGTH;
		}
		return {
			name: thisname,
			category: "Visiting Vistas",
			items: ["Region"],
			values: [desc[0]],
			description: "Reach the vista point in " + v + ".",
			comments: "Room: " + items[1] + " at x: " + String(roomX) + ", y: " + String(roomY) + "; is a " + ((idx >= 0) ? "stock" : "customized") + " location." + getMapLink(items[1]),
			paint: [
				{ type: "icon", value: "vistaicon", scale: 1, color: colorFloatToString(RainWorldColors.Unity_white), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: desc[0], color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	},
	BingoEnterRegionFromChallenge: function(desc) {
		const thisname = "BingoEnterRegionFromChallenge";
		//	desc of format ["System.String|GW|From|0|regionsreal", "System.String|SH|To|0|regionsreal", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "From", , "regionsreal"], "from region");
		var r1 = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
		r1 = r1.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r1 == "")
			throw new TypeError(thisname + ": error, region \"" + items[1] + "\" not found in regionCodeToDisplayName[]");
		var itemTo = checkSettingbox(thisname, desc[1], ["System.String", , "To", , "regionsreal"], "to region");
		var r2 = (regionCodeToDisplayName[itemTo[1]] || "") + " / " + (regionCodeToDisplayNameSaint[itemTo[1]] || "");
		r2 = r2.replace(/^\s\/\s|\s\/\s$/g, "");
		if (r2 == "")
			throw new TypeError(thisname + ": error, region \"" + itemTo[1] + "\" not found in regionCodeToDisplayName[]");
		var b = Array(5); b.fill(0);
		b[0] = challengeValue(thisname);
		b[3] = enumToValue(items[1], "regionsreal");
		b[4] = enumToValue(itemTo[1], "regionsreal");
		b[2] = b.length - GOAL_LENGTH;
		return {
			name: thisname,
			category: "Entering a region from another region",
			items: [items[2], itemTo[2]],
			values: [items[1], itemTo[1]],
			description: "First time entering " + r1 + " must be from " + r2 + ".",
			comments: "",
			paint: [
				{ type: "text", value: items[1], color: colorFloatToString(RainWorldColors.Unity_white) },
				{ type: "icon", value: "keyShiftA", scale: 1, color: colorFloatToString(RainWorldColors.Unity_red), rotation: 90 },
				{ type: "text", value: itemTo[1], color: colorFloatToString(RainWorldColors.Unity_white) }
			],
			toBin: new Uint8Array(b)
		};
	}
};


/* * * Enum Arrays and Maps * * */

/**
 *	Possible Passages (achievements); used by BingoAchievementChallenge
 *	Game extract: WinState::PassageDisplayName
 */
const passageToDisplayNameMap = {
	"Survivor":     "The Survivor",
	"Hunter":       "The Hunter",
	"Saint":        "The Saint",
	"Traveller":    "The Wanderer",
	"Chieftain":    "The Chieftain",
	"Monk":         "The Monk",
	"Outlaw":       "The Outlaw",
	"DragonSlayer": "The Dragon Slayer",
	"Scholar":      "The Scholar",
	"Friend":       "The Friend",
	"Nomad":        "The Nomad",
	"Martyr":       "The Martyr",
	"Pilgrim":      "The Pilgrim",
	"Mother":       "The Mother"
};

/**
 *	Stealable items; used by BingoStealChallenge
 *	Value type: internal item name
 */
const BingoEnum_theft = [
	//	ChallengeUtils.stealableStoable
	"Spear",
	"Rock",
	"ScavengerBomb",
	"Lantern",
	"GooieDuck",
	"GlowWeed",
	"DataPearl"	//	added by GetCorrectListForChallenge()
];

/**
 *	Expedition items; used by BingoItemHoardChallenge
 *	Value type: internal item name
 */
const BingoEnum_expobject = [
	"FirecrackerPlant",
	"SporePlant",
	"FlareBomb",
	"FlyLure",
	"JellyFish",
	"Lantern",
	"Mushroom",
	"PuffBall",
	"ScavengerBomb",
	"VultureMask"
];

/**
 *	Weapon items; used by BingoKillChallenge
 *	Value type: internal item name
 *	Special case: element [0] is used literally (display text)
 *	Special case: weaponsnojelly removes JellyFish item
 */
const BingoEnum_Weapons = [
	//	ChallengeUtils.Weapons
	"Any Weapon",
	"Spear",
	"Rock",
	"ScavengerBomb",
	"JellyFish",
	"PuffBall",
	"LillyPuck"
];

/**
 *	Don't-use-able items; used by BingoDontUseItemChallenge
 *	Value type: internal item name
 */
const BingoEnum_Bannable = [
	//	ChallengeUtils.Bannable
	"Lantern",
	"PuffBall",
	"VultureMask",
	"ScavengerBomb",
	"FirecrackerPlant",
	"BubbleGrass",
	"Rock"
];

/**
 *	Tame-able creatures; used by BingoTameChallenge
 *	Value type: internal creature name
 */
const BingoEnum_Befriendable = [
	//	ChallengeUtils.Befriendable
	"CicadaA",
	"CicadaB",
	"GreenLizard",
	"PinkLizard",
	"YellowLizard",
	"BlackLizard",
	"CyanLizard",
	"WhiteLizard",
	"BlueLizard",
	"EelLizard",
	"SpitLizard",
	"ZoopLizard"
];

/**
 *	Craftable items; used by BingoCraftChallenge
 *	Value type: internal item name
 */
const BingoEnum_CraftableItems = [
	//	ChallengeUtils.CraftableItems
	"FlareBomb",
	"SporePlant",
	"ScavengerBomb",
	"JellyFish",
	"DataPearl",
	"BubbleGrass",
	"FlyLure",
	"SlimeMold",
	"FirecrackerPlant",
	"PuffBall",
	"Mushroom",
	"Lantern",
	"GlowWeed",
	"GooieDuck",
	"FireEgg"
];

/**
 *	Edible items; used by BingoEatChallenge
 *	Value type: internal item or creature name
 */
const BingoEnum_FoodTypes = [
	//	ChallengeUtils.FoodTypes
	"DangleFruit",
	"EggBugEgg",
	"WaterNut",
	"SlimeMold",
	"JellyFish",
	"Mushroom",
	"GooieDuck",
	"LillyPuck",
	"DandelionPeach",
	"GlowWeed",
	"VultureGrub",
	"Hazer",
	"SmallNeedleWorm",
	"Fly",
	"SmallCentipede"
];

/**
 *	Convert region code to display name.
 *	From: https://rainworld.miraheze.org/wiki/User:Alphappy/Region_codes
 */
const regionCodeToDisplayName = {
	"CC": "Chimney Canopy",
	"DM": "Looks to the Moon",
	"DS": "Drainage System",
	"GW": "Garbage Wastes",
	"HI": "Industrial Complex",
	"LC": "Metropolis",
	"LF": "Farm Arrays",
	"LM": "Waterfront Facility",
	"MS": "Submerged Superstructure",
	"OE": "Outer Expanse",
	"RM": "The Rot",
	"SB": "Subterranean",
	"SH": "Shaded Citadel",
	"SI": "Sky Islands",
	"SL": "Shoreline",
	"SS": "Five Pebbles",
	"SU": "Outskirts",
	"UW": "The Exterior",
	"VS": "Pipeyard"
};

/**
 *	Convert region code to display name, Saint world state.
 *	From: https://rainworld.miraheze.org/wiki/User:Alphappy/Region_codes
 */
const regionCodeToDisplayNameSaint = {
	"CC": "Solitary Towers",
	"CL": "Silent Construct",
	"GW": "Glacial Wasteland",
	"HI": "Icy Monument",
	"HR": "Rubicon",
	"LF": "Desolate Fields",
	"SB": "Primordial Underground",
	"SI": "Windswept Spires",
	"SL": "Frigid Coast",
	"SU": "Suburban Drifts",
	"UG": "Undergrowth",
	"VS": "Barren Conduits"
};

const BingoEnum_AllRegionCodes = [
	"Any Region",
	"CC", "CL", "DM", "DS",
	"GW", "HI", "HR", "LC",
	"LF", "LM", "MS", "OE",
	"RM", "SB", "SH", "SI",
	"SL", "SS", "SU", "UG",
	"UW", "VS"
];

/**
 *	Subregions; used by BingoKillChallenge
 *	Value type: string, display text
 */
const BingoEnum_Subregions = [
	//	ChallengeUtils.AllSubregions
	"Any Subregion",
	"Chimney Canopy",
	"Drainage System",
	"Garbage Wastes",
	"Industrial Complex",
	"Farm Arrays",
	"Subterranean",
	"Depths",
	"Filtration System",
	"Shaded Citadel",
	"Memory Crypts",
	"Sky Islands",
	"Communications Array",
	"Shoreline",
	"Looks to the Moon",
	"Five Pebbles",
	"Five Pebbles (Memory Conflux)",
	"Five Pebbles (Recursive Transform Array)",
	"Five Pebbles (Unfortunate Development)",
	"Five Pebbles (General Systems Bus)",
	"Outskirts",
	"The Leg",
	"Underhang",
	"The Wall",
	"The Gutter",
	"The Precipice",
	"Frosted Cathedral",
	"The Husk",
	"Silent Construct",
	"Looks to the Moon (Abstract Convergence Manifold)",
	"Struts",
	"Looks to the Moon (Neural Terminus)",
	"Luna",
	"Looks to the Moon (Memory Conflux)",
	"Looks to the Moon (Vents)",
	"Metropolis",
	"Atop the Tallest Tower",
	"The Floor",
	"12th Council Pillar, the House of Braids",
	"Waterfront Facility",
	"Waterfront Facility",
	"The Shell",
	"Submerged Superstructure",
	"Submerged Superstructure (The Heart)",
	"Auxiliary Transmission Array",
	"Submerged Superstructure (Vents)",
	"Bitter Aerie",
	"Outer Expanse",
	"Sunken Pier",
	"Facility Roots (Western Intake)",
	"Journey's End",
	"The Rot",
	"Five Pebbles (Primary Cortex)",
	"The Rot (Depths)",
	"The Rot (Cystic Conduit)",
	"Five Pebbles (Linear Systems Rail)",
	"Undergrowth",
	"Pipeyard",
	"Sump Tunnel"
];

/**
 *	Subregions, Saint (where different); used by BingoKillChallenge
 *	Value type: string, display text
 */
const BingoEnum_SubregionsSaint = [
	//	ChallengeUtils.SaintSubregions
	"Solitary Towers",
	"Forgotten Conduit",
	"Frosted Cathedral",
	"The Husk",
	"Silent Construct",
	"Five Pebbles",
	"Glacial Wasteland",
	"Icy Monument",
	"Desolate Fields",
	"Primordial Underground",
	"...",
	"Ancient Labyrinth",
	"Windswept Spires",
	"Frozen Mast",
	"Frigid Coast",
	"Looks to the Moon",
	"The Precipice",
	"Suburban Drifts",
	"Undergrowth",
	"Barren Conduits",
	"Desolate Canal",
	"???"
];

/**
 *	All subregions; concatenation of BingoEnum_Subregions and
 *	BingoEnum_SubregionsSaint, sorted alphabetically, duplicates removed.
 *	Value type: string, display text
 */
const BingoEnum_AllSubregions = [
	"Any Subregion",
	"...",
	"???",
	"12th Council Pillar, the House of Braids",
	"Ancient Labyrinth",
	"Atop the Tallest Tower",
	"Auxiliary Transmission Array",
	"Barren Conduits",
	"Bitter Aerie",
	"Chimney Canopy",
	"Communications Array",
	"Depths",
	"Desolate Canal",
	"Desolate Fields",
	"Drainage System",
	"Facility Roots (Western Intake)",
	"Farm Arrays",
	"Filtration System",
	"Five Pebbles",
	"Five Pebbles (General Systems Bus)",
	"Five Pebbles (Linear Systems Rail)",
	"Five Pebbles (Memory Conflux)",
	"Five Pebbles (Primary Cortex)",
	"Five Pebbles (Recursive Transform Array)",
	"Five Pebbles (Unfortunate Development)",
	"Forgotten Conduit",
	"Frigid Coast",
	"Frosted Cathedral",
	"Frozen Mast",
	"Garbage Wastes",
	"Glacial Wasteland",
	"Icy Monument",
	"Industrial Complex",
	"Journey's End",
	"Looks to the Moon",
	"Looks to the Moon (Abstract Convergence Manifold)",
	"Looks to the Moon (Memory Conflux)",
	"Looks to the Moon (Neural Terminus)",
	"Looks to the Moon (Vents)",
	"Luna",
	"Memory Crypts",
	"Metropolis",
	"Outer Expanse",
	"Outskirts",
	"Pipeyard",
	"Primordial Underground",
	"Shaded Citadel",
	"Shoreline",
	"Silent Construct",
	"Sky Islands",
	"Solitary Towers",
	"Struts",
	"Submerged Superstructure",
	"Submerged Superstructure (The Heart)",
	"Submerged Superstructure (Vents)",
	"Subterranean",
	"Suburban Drifts",
	"Sump Tunnel",
	"Sunken Pier",
	"The Floor",
	"The Gutter",
	"The Husk",
	"The Leg",
	"The Precipice",
	"The Rot",
	"The Rot (Cystic Conduit)",
	"The Rot (Depths)",
	"The Shell",
	"The Wall",
	"Undergrowth",
	"Underhang",
	"Waterfront Facility",
	"Windswept Spires"
];

/**
 *	Creatures that can be dropped in the Depths pit; used by BingoDepthsChallenge
 *	Value type: string, creature internal name
 */
const BingoEnum_Depthable = [
	"Hazer",
	"VultureGrub",
	"SmallNeedleWorm",
	"TubeWorm",
	"SmallCentipede",
	"Snail",
	"LanternMouse"
];

/**
 *	Transportable creature targets; used by BingoTransportChallenge
 *	Value type: string, creature internal name
 */
const BingoEnum_Transportable = [
	"JetFish",
	"Hazer",
	"VultureGrub",
	"CicadaA",
	"CicadaB",
	"Yeek"
];

/**
 *	Pinnable creature targets; used by BingoPinChallenge
 *	Value type: string, creature internal name
 */
const BingoEnum_Pinnable = [
	"CicadaA",
	"CicadaB",
	"Scavenger",
	"BlackLizard",
	"PinkLizard",
	"BlueLizard",
	"YellowLizard",
	"WhiteLizard",
	"GreenLizard",
	"Salamander",
	"Dropbug",
	"Snail",
	"Centipede",
	"Centiwing",
	"LanternMouse"
];

/**
 *	Bombable toll targets; used by BingoBombTollChallenge
 *	Value type: string, room name (lowercased)
 */
const BingoEnum_BombableOutposts = [
	"su_c02",
	"gw_c05",
	"gw_c11",
	"lf_e03",
	"ug_toll"
];

/**
 *	Arena unlocks, blue (item/creature); used by BingoUnlockChallenge
 *	Value type: string, unlock internal name
 */
const BingoEnum_ArenaUnlocksBlue = [
	"AquaCenti",
	"BigCentipede",
	"BigEel",
	"BigJelly",
	"BigNeedleWorm",
	"BigSpider",
	"BlackLizard",
	"BlueLizard",
	"BrotherLongLegs",
	"BubbleGrass",
	"Centiwing",
	"CicadaA",
	"CyanLizard",
	"DaddyLongLegs",
	"DandelionPeach",
	"DangleFruit",
	"Deer",
	"DropBug",
	"EelLizard",
	"EggBug",
	"ElectricSpear",
	"FireSpear",
	"FirecrackerPlant",
	"FlareBomb",
	"FlyLure",
	"GlowWeed",
	"GooieDuck",
	"Hazer",
	"Inspector",
	"JellyFish",
	"JetFish",
	"JungleLeech",
	"KingVulture",
	"Lantern",
	"LanternMouse",
	"Leech",
	"LillyPuck",
	"MirosBird",
	"MirosVulture",
	"MotherSpider",
	"Mushroom",
	"Pearl",
	"PoleMimic",
	"PuffBall",
	"RedCentipede",
	"RedLizard",
	"Salamander",
	"Scavenger",
	"ScavengerBomb",
	"ScavengerElite",
	"SeaLeech",
	"SingularityBomb",
	"SlimeMold",
	"SlugNPC",
	"SmallCentipede",
	"Snail",
	"Spider",
	"SpitLizard",
	"SpitterSpider",
	"SporePlant",
	"TentaclePlant",
	"TerrorLongLegs",
	"TubeWorm",
	"Vulture",
	"VultureGrub",
	"VultureMask",
	"WaterNut",
	"WhiteLizard",
	"Yeek",
	"YellowLizard",
	"ZoopLizard"
];

/**
 *	Arena unlocks, gold (arenas); used by BingoUnlockChallenge
 *	Value type: string, unlock internal name
 */
const BingoEnum_ArenaUnlocksGold = [
	"CC",
	"CL",
	"DM",
	"DS",
	"GW",
	"GWold",
	"HI",
	"LC",
	"LF",
	"LM",
	"MS",
	"OE",
	"RM",
	"SB",
	"SH",
	"SI",
	"SL",
	"SU",
	"UG",
	"UW",
	"VS",
	"filter",
	"gutter"
];

/**
 *	Gold arena unlocks: additional subregion names; used by BingoUnlockChallenge
 *	Key type: string, unlock internal name
 *	Value type: string, arenas unlock display name
 */
const arenaUnlocksGoldToDisplayName = {
	"GWold": "Past Garbage Wastes",
	"filter": "Filtration System",
	"gutter": "The Gutter",
};

/**
 *	Arena unlocks, green (character); used by BingoUnlockChallenge
 *	Value type: string, unlock internal name
 */
const BingoEnum_ArenaUnlocksGreen = [
	"Artificer",
	"Gourmand",
	"Rivulet",
	"Saint",
	"Spearmaster"
];

/**
 *	Arena unlocks, red (Safari); used by BingoUnlockChallenge
 *	Value type: string, unlock internal name
 */
const BingoEnum_ArenaUnlocksRed = [
	"CC-safari",
	"CL-safari",
	"DM-safari",
	"DS-safari",
	"GW-safari",
	"HI-safari",
	"LC-safari",
	"LF-safari",
	"LM-safari",
	"MS-safari",
	"OE-safari",
	"RM-safari",
	"SB-safari",
	"SH-safari",
	"SI-safari",
	"SL-safari",
	"SS-safari",
	"SU-safari",
	"UG-safari",
	"UW-safari",
	"VS-safari"
];

var BingoEnum_AllUnlocks = BingoEnum_ArenaUnlocksBlue.concat(
			BingoEnum_ArenaUnlocksGold).concat(
			BingoEnum_ArenaUnlocksRed).concat(
			BingoEnum_ArenaUnlocksGreen);

/**
 *	Assorted color constants that don't belong to any
 *	particular object, type or class.
 */
const RainWorldColors = {
	//	RainWorld (global consts?), HSL2RGB'd and mathed as needed
	"AntiGold":            [0.2245,   0.519817, 0.8355   ],
	"GoldHSL":             [0.8355,   0.540183, 0.2245   ],
	"GoldRGB":             [0.529,    0.365,    0.184    ],
	"SaturatedGold":       [1,        0.73,     0.368    ],
	"MapColor":            [0.381333, 0.32,     0.48     ],
	//	CollectToken
	"RedColor":            [1,        0,        0        ],
	"GreenColor":          [0.265234, 0.8355,   0.2245   ],
	"WhiteColor":          [0.53,     0.53,     0.53     ],
	"DevColor":            [0.8648,   0,        0.94     ],
	"TokenDefault":        [1,        0.6,      0.05     ],	//	BingoUnlockChallenge::IconDataForUnlock "gold" default
	//	PlayerGraphics::DefaultSlugcatColor, prefix with "Slugcat_"
	"Slugcat_White":       [1,        1,        1        ],
	"Slugcat_Yellow":      [1,        1,        0.45098  ],
	"Slugcat_Red":         [1,        0.45098,  0.45098  ],
	"Slugcat_Night":       [0.092,    0.1388,   0.308    ],
	"Slugcat_Sofanthiel":  [0.09,     0.14,     0.31     ],
	"Slugcat_Rivulet":     [0.56863,  0.8,      0.94118  ],
	"Slugcat_Artificer":   [0.43922,  0.13725,  0.23529  ],
	"Slugcat_Saint":       [0.66667,  0.9451,   0.33725  ],
	"Slugcat_Spear":       [0.31,     0.18,     0.41     ],
	"Slugcat_Spearmaster": [0.31,     0.18,     0.41     ],	//	avoid special cases detecting "Spear" vs. "Spearmaster"
	"Slugcat_Gourmand":    [0.94118,  0.75686,  0.59216  ],
	//	UnityEngine.Color, prefix with "Unity_"
	"Unity_red":           [1,        0,        0        ],
	"Unity_green":         [0,        1,        0        ],
	"Unity_blue":          [0,        0,        1        ],
	"Unity_white":         [1,        1,        1        ],
	"Unity_black":         [0,        0,        0        ],
	"Unity_yellow":        [1,        0.921569, 0.0156863],
	"Unity_cyan":          [0,        1,        1        ],
	"Unity_magenta":       [1,        0,        1        ],
	"Unity_gray":          [0.5,      0.5,      0.5      ],
	"Unity_grey":          [0.5,      0.5,      0.5      ],
	//	Hard-coded Bingo and Expedition colors
	"ExpHidden":           [1,        0.75,     0.1      ],
	"GuidanceNeuron":      [0,        1,        0.3      ],
	"GuidanceMoon":        [1,        0.8,      0.3      ],
	"nomscpebble":         [0.447059, 0.901961, 0.768627 ],
	"popcorn_plant":       [0.41,     0.16,     0.23     ]
};

/**
 *	Convert creature value string to display text.
 *	Game extract: Expedition.ChallengeTools::CreatureName
 *	Additions patched in from creatureNameToIconAtlasMap and sorted to match
 *	Note: these are plural; see creatureNameToSingular() for the other case.
 */
const creatureNameToDisplayTextMap = {
	"Slugcat":         "Slugcats",
	"GreenLizard":     "Green Lizards",
	"PinkLizard":      "Pink Lizards",
	"BlueLizard":      "Blue Lizards",
	"CyanLizard":      "Cyan Lizards",
	"RedLizard":       "Red Lizards",
	"WhiteLizard":     "White Lizards",
	"BlackLizard":     "Black Lizards",
	"YellowLizard":    "Yellow Lizards",
	"Salamander":      "Salamanders",
	"Scavenger":       "Scavengers",
	"Vulture":         "Vultures",
	"KingVulture":     "King Vultures",
	"CicadaA":         "White Squidcadas",
	"CicadaB":         "Black Squidcadas",
	"Snail":           "Snails",
	"Centiwing":       "Centiwings",
	"SmallCentipede":  "Small Centipedes",
	"Centipede":       "Large Centipedes",
	"BigCentipede":    "Overgrown Centipedes",	//	Used by unlock token
	"RedCentipede":    "Red Centipedes",
	"BrotherLongLegs": "Brother Long Legs",
	"DaddyLongLegs":   "Daddy Long Legs",
	"LanternMouse":    "Lantern Mice",
	"GarbageWorm":     "Garbage Worms",
	"Fly":             "Batflies",
	"Leech":           "Leeches",
	"SeaLeech":        "Sea Leeches",
	"JetFish":         "Jetfish",
	"BigEel":          "Leviathans",
	"Deer":            "Rain Deer",
	"TubeWorm":        "Tube Worms",
	"Spider":          "Coalescipedes",
	"BigSpider":       "Large Spiders",
	"SpitterSpider":   "Spitter Spiders",
	"MirosBird":       "Miros Birds",
	"TentaclePlant":   "Monster Kelp",
	"PoleMimic":       "Pole Mimics",
	"Overseer":        "Overseers",
	"VultureGrub":     "Vulture Grubs",
	"EggBug":          "Egg Bugs",
	"BigNeedleWorm":   "Large Noodleflies",
	"SmallNeedleWorm": "Baby Noodleflies",
	"DropBug":         "Dropwigs",
	"Hazer":           "Hazers",
	"TrainLizard":     "Train Lizards",
	"ZoopLizard":      "Strawberry Lizards",
	"EelLizard":       "Eel Lizards",
	"JungleLeech":     "Jungle Leeches",
	"TerrorLongLegs":  "Terror Long Legs",
	"MotherSpider":    "Mother Spiders",
	"StowawayBug":     "Stowaway Bugs",
	"HunterDaddy":     "Hunter Long Legs",
	"FireBug":         "Firebugs",
	"AquaCenti":       "Aquapedes",
	"MirosVulture":    "Miros Vultures",
	"ScavengerElite":  "Elite Scavengers",
	"ScavengerKing":   "King Scavengers",
	"SpitLizard":      "Caramel Lizards",
	"Inspector":       "Inspectors",
	"Yeek":            "Yeeks",
	"BigJelly":        "Large Jellyfish",
	"SlugNPC":         "Slugpups",
	"Default":         "Unknown Creatures"
};

/**
 *	Refactoring of creatureNameToIconAtlas to associative array.
 */
const creatureNameToIconAtlasMap = {
	"Slugcat":        	"Kill_Slugcat",
	"GreenLizard":    	"Kill_Green_Lizard",
	"PinkLizard":     	"Kill_Standard_Lizard",
	"BlueLizard":     	"Kill_Standard_Lizard",
	"CyanLizard":     	"Kill_Standard_Lizard",
	"RedLizard":      	"Kill_Standard_Lizard",
	"WhiteLizard":    	"Kill_White_Lizard",
	"BlackLizard":    	"Kill_Black_Lizard",
	"YellowLizard":   	"Kill_Yellow_Lizard",
	"Salamander":     	"Kill_Salamander",
	"Scavenger":      	"Kill_Scavenger",
	"Vulture":        	"Kill_Vulture",
	"KingVulture":    	"Kill_KingVulture",
	"CicadaA":        	"Kill_Cicada",
	"CicadaB":        	"Kill_Cicada",
	"Snail":          	"Kill_Snail",
	"Centiwing":      	"Kill_Centiwing",
	"SmallCentipede": 	"Kill_Centipede1",
	"Centipede":      	"Kill_Centipede2",
	"BigCentipede":     "Kill_Centipede3",	//	Used by unlock token
	"RedCentipede":   	"Kill_Centipede3",
	"BrotherLongLegs":	"Kill_Daddy",
	"DaddyLongLegs":  	"Kill_Daddy",
	"LanternMouse":   	"Kill_Mouse",
	"GarbageWorm":    	"Kill_Garbageworm",
	"Fly":            	"Kill_Bat",
	"Leech":          	"Kill_Leech",
	"SeaLeech":       	"Kill_Leech",
	"JetFish":        	"Kill_Jetfish",
	"BigEel":         	"Kill_BigEel",
	"Deer":           	"Kill_RainDeer",
	"TubeWorm":       	"Kill_Tubeworm",
	"Spider":         	"Kill_SmallSpider",
	"BigSpider":      	"Kill_BigSpider",
	"SpitterSpider":  	"Kill_BigSpider",
	"MirosBird":      	"Kill_MirosBird",
	"TentaclePlant":  	"Kill_TentaclePlant",
	"PoleMimic":      	"Kill_PoleMimic",
	"Overseer":       	"Kill_Overseer",
	"VultureGrub":    	"Kill_VultureGrub",
	"EggBug":         	"Kill_EggBug",
	"BigNeedleWorm":  	"Kill_NeedleWorm",
	"SmallNeedleWorm":	"Kill_SmallNeedleWorm",
	"DropBug":        	"Kill_DropBug",
	"Hazer":          	"Kill_Hazer",
	"TrainLizard":    	"Kill_Standard_Lizard",
	"ZoopLizard":     	"Kill_White_Lizard",
	"EelLizard":      	"Kill_Salamander",
	"JungleLeech":    	"Kill_Leech",
	"TerrorLongLegs": 	"Kill_Daddy",
	"MotherSpider":   	"Kill_BigSpider",
	"StowawayBug":    	"Kill_Stowaway",
	"HunterDaddy":    	"Kill_Slugcat",
	"FireBug":        	"Kill_FireBug",
	"AquaCenti":      	"Kill_Centiwing",
	"MirosVulture":   	"Kill_MirosBird",
	"ScavengerElite": 	"Kill_ScavengerElite",
	"ScavengerKing":  	"Kill_ScavengerKing",
	"SpitLizard":     	"Kill_Spit_Lizard",
	"Inspector":      	"Kill_Inspector",
	"Yeek":           	"Kill_Yeek",
	"BigJelly":       	"Kill_BigJellyFish",
	"SlugNPC":        	"Kill_Slugcat",
	"Default":        	"Futile_White"
};

/**
 *	Convert creature to color.
 *	Refactoring of creatureNameToIconColor() to associative array.
 *	Sorted to match creatureNameToIconAtlasMap (with defaults removed).
 *	Key type: internal creature name
 *	Value type: array, 3 elements, numeric; RGB float color
 *	Note: use colorFloatToString() to obtain HTML colors.
 */
const creatureNameToIconColorMap = {
	"Slugcat":        	[1,        1,        1       ],
	"GreenLizard":    	[0.2,      1,        0       ],
	"PinkLizard":     	[1,        0,        1       ],
	"BlueLizard":     	[0,        0.5,      1       ],
	"CyanLizard":     	[0,        0.909804, 0.901961],
	"RedLizard":      	[0.901961, 0.054902, 0.054902],
	"WhiteLizard":    	[1,        1,        1       ],
	"BlackLizard":    	[0.368627, 0.368627, 0.435294],
	"YellowLizard":	  	[1,        0.6,      0       ],
	"Salamander":     	[0.933333, 0.780392, 0.894118],
	"Vulture":        	[0.831373, 0.792157, 0.435294],
	"KingVulture":    	[0.831373, 0.792157, 0.435294],
	"CicadaA":        	[1,        1,        1       ],
	"CicadaB":        	[0.368627, 0.368627, 0.435294],
	"Centiwing":      	[0.054902, 0.698039, 0.235294],
	"SmallCentipede": 	[1,        0.6,      0       ],
	"Centipede":      	[1,        0.6,      0       ],
	"BigCentipede":   	[1,        0.6,      0       ],	//	Used by unlock token
	"RedCentipede":   	[0.901961, 0.054902, 0.054902],
	"BrotherLongLegs":	[0.454902, 0.52549,  0.305882],
	"DaddyLongLegs":  	[0,        0,        1       ],
	"Leech":          	[0.682353, 0.156863, 0.117647],
	"SeaLeech":       	[0.05,     0.3,      0.7     ],
	"TubeWorm":       	[0.05,     0.3,      0.7     ],
	"SpitterSpider":  	[0.682353, 0.156863, 0.117647],
	"Overseer":       	[0,        0.909804, 0.901961],
	"VultureGrub":    	[0.831373, 0.792157, 0.435294],
	"EggBug":         	[0,        1,        0.470588],
	"BigNeedleWorm":  	[1,        0.596078, 0.596078],
	"SmallNeedleWorm":	[1,        0.596078, 0.596078],
	"Hazer":          	[0.211765, 0.792157, 0.388235],
	"TrainLizard":    	[0.3,      0,        1       ],
	"ZoopLizard":     	[0.95,     0.73,     0.73    ],
	"EelLizard":      	[0.02,     0.780392, 0.2     ],
	"JungleLeech":    	[0.1,      0.7,      0.1     ],
	"TerrorLongLegs": 	[0.3,      0,        1       ],
	"MotherSpider":   	[0.1,      0.7,      0.1     ],
	"StowawayBug":    	[0.368627, 0.368627, 0.435294],
	"HunterDaddy":    	[0.8,      0.470588, 0.470588],
	"FireBug":        	[1,        0.470588, 0.470588],
	"AquaCenti":      	[0,        0,        1       ],
	"MirosVulture":   	[0.901961, 0.054902, 0.054902],
	"SpitLizard":     	[0.55,     0.4,      0.2     ],
	"Inspector":      	[0.447059, 0.901961, 0.768627],
	"Yeek":           	[0.9,      0.9,    0.9       ],
	"BigJelly":       	[1,        0.85,   0.7       ],
	"Default":        	[0.66384,  0.6436, 0.6964    ]
};

/**
 *	Convert items to display text.
 *	Key type: internal item name
 *	Value type: display text (English)
 *	Note: two items with intData parameters have been integrated for completeness.
 *	Append the intData parameter (if present or nonzero) to the item name.
 *	These are:
 *	"VultureMask1", "VultureMask2", "Spear1", "Spear2", "Spear3"
 */
const itemNameToDisplayTextMap = {
	//	base game, Expedition::ChallengeTools.ItemName
	"FirecrackerPlant": "Firecracker Plants",
	"FlareBomb":        "Flare Bombs",
	"FlyLure":          "Fly Lures",
	"JellyFish":        "Jellyfish",
	"Lantern":          "Scavenger Lanterns",
	"Mushroom":         "Mushrooms",
	"PuffBall":         "Puff Balls",
	"ScavengerBomb":    "Scavenger Bombs",
	"VultureMask":      "Vulture Masks",
	"VultureMask1":     "King Vulture Masks",	//	appended intData for completeness
	"VultureMask2":     "Chieftan Masks",
	//	bingo, ChallengeUtils::ChallengeTools_ItemName
	"Spear":            "Spears",
	"Spear1":           "Explosive Spears",	//	appended intData for completeness
	"Spear2":           "Electric Spears",
	"Spear3":           "Fire Spears",
	"Rock":             "Rocks",
	"SporePlant":       "Bee Hives",
	"DataPearl":        "Pearls",
	"DangleFruit":      "Blue Fruit",
	"EggBugEgg":        "Eggbug Eggs",
	"WaterNut":         "Bubble Fruit",
	"SlimeMold":        "Slime Mold",
	"BubbleGrass":      "Bubble Grass",
	"GlowWeed":         "Glow Weed",
	"DandelionPeach":   "Dandelion Peaches",
	"LillyPuck":        "Lillypucks",
	"GooieDuck":        "Gooieducks",
	//	manual adds
	"NeedleEgg":        "Noodlefly Eggs",
	"OverseerCarcass":  "Overseer Eyes",
	"KarmaFlower":      "Karma Flowers",
	//	Used by unlock tokens (why are they different :agony:)
	"ElectricSpear":    "Electric Spears",
	"FireSpear":        "Fire Spears",
	"Pearl":            "Pearls",
	//	entries in itemNameToIconAtlasMap missing from above
	"SLOracleSwarmer":  "Neuron Flies",
	"SSOracleSwarmer":  "Neuron Flies",
	"NSHSwarmer":       "Green Neuron Flies",
	"PebblesPearl":     "Pearls",
	"HalcyonPearl":     "Pearls",
	"Spearmasterpearl": "Pearls",
	"EnergyCell":       "Rarefaction Cells",
	"SingularityBomb":  "Singularity Bombs",
	"MoonCloak":        "Moon's Cloak",
	"FireEgg":          "Firebug Eggs",
	"JokeRifle":        "Joke Rifles",
	"Seed":             "Popcorn Seeds",
	"Default":          "Unknown Items"
};

/**
 *	Convert items to atlas icons.
 *	Key type: internal item name
 *	Value type: atlas icon name
 *	Sorted approximately from itemNameToIconColorMap.
 */
const itemNameToIconAtlasMap = {
	//	base game, ItemSymbol.SpriteNameForItem
	"Rock":             "Symbol_Rock",
	"SporePlant":       "Symbol_SporePlant",
	"FirecrackerPlant": "Symbol_Firecracker",
	"ScavengerBomb":    "Symbol_StunBomb",
	"Spear":            "Symbol_Spear",
	"Spear1":           "Symbol_FireSpear",
	"Spear2":           "Symbol_ElectricSpear",
	"Spear3":           "Symbol_HellSpear",
	"Lantern":          "Symbol_Lantern",
	"FlareBomb":        "Symbol_FlashBomb",
	"PuffBall":         "Symbol_PuffBall",
	"SlimeMold":        "Symbol_SlimeMold",
	"BubbleGrass":      "Symbol_BubbleGrass",
	"DangleFruit":      "Symbol_DangleFruit",
	"Mushroom":         "Symbol_Mushroom",
	"WaterNut":         "Symbol_WaterNut",
	"EggBugEgg":        "Symbol_EggBugEgg",
	"FlyLure":          "Symbol_FlyLure",
	"JellyFish":        "Symbol_JellyFish",
	"VultureMask":      "Kill_Vulture",
	"VultureMask1":     "Kill_KingVulture",
	"VultureMask2":     "Symbol_ChieftainMask",
	"SLOracleSwarmer":  "Symbol_Neuron",
	"SSOracleSwarmer":  "Symbol_Neuron",
	"NSHSwarmer":       "Symbol_Neuron",
	"NeedleEgg":        "needleEggSymbol",
	"OverseerCarcass":  "Kill_Overseer",
	"PebblesPearl":     "Symbol_Pearl",
	"DataPearl":        "Symbol_Pearl",
	"HalcyonPearl":     "Symbol_Pearl",
	"Spearmasterpearl": "Symbol_Pearl",
	"EnergyCell":       "Symbol_EnergyCell",
	"SingularityBomb":  "Symbol_Singularity",
	"GooieDuck":        "Symbol_GooieDuck",
	"LillyPuck":        "Symbol_LillyPuck",
	"GlowWeed":         "Symbol_GlowWeed",
	"DandelionPeach":   "Symbol_DandelionPeach",
	"MoonCloak":        "Symbol_MoonCloak",
	"FireEgg":          "Symbol_FireEgg",
	"JokeRifle":        "Symbol_JokeRifle",
	"Seed":             "Symbol_Seed",
	"Default":          "Futile_White",
	//	Used by unlock tokens
	"FireSpear":        "Symbol_FireSpear",
	"ElectricSpear":    "Symbol_ElectricSpear",
	"Pearl":            "Symbol_Pearl"
};

/**
 *	Colored data pearl types, indexed by intData parameter
 *	Use to convert pearl index to expanded text name, for use with:
 *	dataPearlToDisplayTextMap[DataPearlList[intData]] and,
 *	dataPearlToColorMap[DataPearlList[intData]] or
 *	itemNameToIconColorMap["Pearl_" + DataPearlList[intData]]
 */
const DataPearlList = [
	,
	,
	//	From DataPearl::AbstractDataPearl.DataPearlType
	"Misc",
	"Misc2",
	"CC",
	"SI_west",
	"SI_top",
	"LF_west",
	"LF_bottom",
	"HI",
	"SH",
	"DS",
	"SB_filtration",
	"SB_ravine",
	"GW",
	"SL_bridge",
	"SL_moon",
	"SU",
	"UW",
	"PebblesPearl",
	"SL_chimney",
	"Red_stomach",
	//	from MoreSlugcats::MoreSlugcatsEnums::DataPearlType.RegisterValues()
	"Spearmasterpearl",
	"SU_filt",
	"SI_chat3",
	"SI_chat4",
	"SI_chat5",
	"DM",
	"LC",
	"OE",
	"MS",
	"RM",
	"Rivulet_stomach",
	"LC_second",
	"CL",
	"VS",
	"BroadcastMisc"
];

/**
 *	Pearl display names.
 *	Key type: internal pearl name
 *	Value type: display name
 *	Note: use colorFloatToString() to obtain HTML colors.
 */
const dataPearlToDisplayTextMap = {
	//	Bingo, ChallengeUtils::NameForPearl()
	"CC":               "Gold",
	"DS":               "Bright Green",
	"GW":               "Viridian",
	"HI":               "Bright Blue",
	"LF_bottom":        "Bright Red",
	"LF_west":          "Deep Pink",
	"SH":               "Deep Magenta",
	"SI_chat3":         "Dark Purple",
	"SI_chat4":         "Olive Green",
	"SI_chat5":         "Dark Magenta",
	"SI_top":           "Dark Blue",
	"SI_west":          "Dark Green",
	"SL_bridge":        "Bright Purple",
	"SL_chimney":       "Bright Magenta",
	"SL_moon":          "Pale Yellow",
	"SB_filtration":    "Teal",
	"SB_ravine":        "Dark Magenta",
	"SU":               "Light Blue",
	"UW":               "Pale Green",
	"VS":               "Deep Purple",
	//	Additional names from Wiki
	"CL":               "Music (faded)",
	"DM":               "Light Yellow",
	"LC":               "Deep Green",
	"LC_second":        "Bronze",
	"MS":               "Dull Yellow",
	"OE":               "Light Purple",
	"Red_stomach":      "Aquamarine",
	"Rivulet_stomach":  "Celadon",
	"RM":               "Music",
	"Spearmasterpearl": "Dark Red",
	"SU_filt":          "Light Pink"
};

/**
 *	Pearl region codes.
 *	Key type: internal pearl name
 *	Value type: region code
 *	Note: "DM" maps to "MS" by default, but "DM" for Spearmaster.
 */
const dataPearlToRegionMap = {
	"CC":               "CC",
	"DS":               "DS",
	"GW":               "GW",
	"HI":               "HI",
	"LF_bottom":        "LF",
	"LF_west":          "LF",
	"SH":               "SH",
	"SI_chat3":         "SI",
	"SI_chat4":         "SI",
	"SI_chat5":         "SI",
	"SI_top":           "SI",
	"SI_west":          "SI",
	"SL_bridge":        "SL",
	"SL_chimney":       "SL",
	"SL_moon":          "SL",
	"SB_filtration":    "SB",
	"SB_ravine":        "SB",
	"SU":               "SU",
	"UW":               "UW",
	"VS":               "VS",
	"CL":               "CL",
	"DM":               "MS",	//	special case: Spear only: DM
	"LC":               "LC",
	"LC_second":        "LC",
	"MS":               "GW",
	"OE":               "OE",
	"RM":               "RM",
	"SU_filt":          "SU"
};

/**
 *	Pearl colors.
 *	Key type: internal pearl name
 *	Value type: array, 3 elements, numeric; RGB float color
 *	Note: use colorFloatToString() to obtain HTML colors.
 */
const dataPearlToColorMap = {
	"Misc":             [0.745,    0.745,    0.745   ],
	"Misc2":            [0.745,    0.745,    0.745   ],
	"CC":               [0.95,     0.8,      0.1     ],
	"SI_west":          [0.05125,  0.2575,   0.175   ],
	"SI_top":           [0.05125,  0.175,    0.2575  ],
	"LF_west":          [1,        0.15,     0.405   ],
	"LF_bottom":        [1,        0.235,    0.235   ],
	"HI":               [0.131863, 0.356863, 1       ],
	"SH":               [0.52,     0.08,     0.316   ],
	"DS":               [0.15,     0.745,    0.235   ],
	"SB_filtration":    [0.235,    0.575,    0.575   ],
	"SB_ravine":        [0.2575,   0.05125,  0.175   ],
	"GW":               [0.125,    0.775,    0.5625  ],
	"SL_bridge":        [0.58,     0.208,    0.93    ],
	"SL_moon":          [0.915,    0.9575,   0.32    ],
	"SU":               [0.575,    0.66,     0.915   ],
	"UW":               [0.49,     0.642,    0.49    ],
	"PebblesPearl":     [0.745,    0.745,    0.745   ],
	"SL_chimney":       [1,        0.105,    0.7075  ],
	"Red_stomach":      [0.6,      1,        0.9     ],
	"Spearmasterpearl": [0.496,    0.01,     0.04    ],
	"SU_filt":          [1,        0.7875,   0.915   ],
	"SI_chat3":         [0.175,    0.05125,  0.2575  ],
	"SI_chat4":         [0.175,    0.2575,   0.05125 ],
	"SI_chat5":         [0.2575,   0.05125,  0.175   ],
	"DM":               [0.963333, 0.933333, 0.326667],
	"LC":               [0.15,     0.49,     0.1636  ],
	"OE":               [0.616667, 0.463333, 0.83    ],
	"MS":               [0.843333, 0.91,     0.38    ],
	"RM":               [0.692157, 0.184314, 0.984314],
	"Rivulet_stomach":  [0.65,     0.89,     0.683333],
	"LC_second":        [0.76,     0.4,      0       ],
	"CL":               [0.742157, 0.284314, 1       ],
	"VS":               [0.765,    0.05,     0.96    ],
	"BroadcastMisc":    [0.911111, 0.775,    0.822222]
};

/**
 *	Complete list of items' colors, including pearls.
 *	Key type: internal item name, or pearl name with "Pearl_" prepended
 *	Value type: array, 3 elements, numeric; RGB float color
 *	Note: use colorFloatToString() to obtain HTML colors.
 *	Any items not found in this list, shall use "Default"'s value instead.
 */
const itemNameToIconColorMap = {
	"Default":                [0.66384,  0.6436,   0.6964  ],
	"SporePlant":             [0.682353, 0.156862, 0.117647],
	"FirecrackerPlant":       [0.682353, 0.156862, 0.117647],
	"ScavengerBomb":          [0.90196,  0.054902, 0.054902],
	"Spear1":                 [0.90196,  0.054902, 0.054902],
	"Spear2":                 [0,        0,        1       ],
	"Spear3":                 [1,        0.470588, 0.470588],
	"Lantern":                [1,        0.572549, 0.317647],
	"FlareBomb":              [0.733333, 0.682353, 1       ],
	"SlimeMold":              [1,        0.6,      0       ],
	"BubbleGrass":            [0.054902, 0.698039, 0.235294],
	"DangleFruit":            [0,        0,        1       ],
	"Mushroom":               [1,        1,        1       ],
	"WaterNut":               [0.05,     0.3,      0.7     ],
	"EggBugEgg":              [0,        1,        0.470588],
	"FlyLure":                [0.678431, 0.266667, 0.211765],
	"SSOracleSwarmer":        [1,        1,        1       ],
	"NSHSwarmer":             [0,        1,        0.3     ],
	"NeedleEgg":              [0.57647,  0.160784, 0.25098 ],
	"PebblesPearl1":          [0.7,      0.7,      0.7     ],
	"PebblesPearl2":          [0.2944,   0.276,    0.324   ],
	"PebblesPearl3":          [1,        0.478431, 0.007843],
	"PebblesPearl":           [0,        0.454902, 0.639216],
	"DataPearl":              [0.7,      0.7,      0.7     ],	//	default values -- access special values by using key:
	"HalcyonPearl":           [0.7,      0.7,      0.7     ],	//	"Pearl" + DataPearlList[intData]
	"DataPearl1":             [1,        0.6,      0.9     ],	//	intData = 1
	"Spearmasterpearl":       [0.5325,   0.1585,   0.184   ],
	"EnergyCell":             [0.01961,  0.6451,   0.85    ],
	"SingularityBomb":        [0.01961,  0.6451,   0.85    ],
	"GooieDuck":              [0.447059, 0.90196,  0.768627],
	"LillyPuck":              [0.170588, 0.96196,  0.998627],
	"GlowWeed":               [0.947059, 1,        0.268627],
	"DandelionPeach":         [0.59,     0.78,     0.96    ],
	"MoonCloak":              [0.95,     1,        0.96    ],
	"FireEgg":                [1,        0.470588, 0.470588],
	//	Used by unlock tokens (why are they different :agony:)
	"ElectricSpear":          [0,        0,        1       ],
	"FireSpear":              [0.90196,  0.054902, 0.054902],
	"Pearl":                  [0.7,      0.7,      0.7     ],
	//	dataPearlToColorMap incorporated here, add "Pearl_" prefix
	"Pearl_Misc":             [0.745,    0.745,    0.745   ],
	"Pearl_Misc2":            [0.745,    0.745,    0.745   ],
	"Pearl_CC":               [0.95,     0.8,      0.1     ],
	"Pearl_SI_west":          [0.05125,  0.2575,   0.175   ],
	"Pearl_SI_top":           [0.05125,  0.175,    0.2575  ],
	"Pearl_LF_west":          [1,        0.15,     0.405   ],
	"Pearl_LF_bottom":        [1,        0.235,    0.235   ],
	"Pearl_HI":               [0.131863, 0.356863, 1       ],
	"Pearl_SH":               [0.52,     0.08,     0.316   ],
	"Pearl_DS":               [0.15,     0.745,    0.235   ],
	"Pearl_SB_filtration":    [0.235,    0.575,    0.575   ],
	"Pearl_SB_ravine":        [0.2575,   0.05125,  0.175   ],
	"Pearl_GW":               [0.125,    0.775,    0.5625  ],
	"Pearl_SL_bridge":        [0.58,     0.208,    0.93    ],
	"Pearl_SL_moon":          [0.915,    0.9575,   0.32    ],
	"Pearl_SU":               [0.575,    0.66,     0.915   ],
	"Pearl_UW":               [0.49,     0.642,    0.49    ],
	"Pearl_PebblesPearl":     [0.745,    0.745,    0.745   ],
	"Pearl_SL_chimney":       [1,        0.105,    0.7075  ],
	"Pearl_Red_stomach":      [0.6,      1,        0.9     ],
	"Pearl_Spearmasterpearl": [0.496,    0.01,     0.04    ],
	"Pearl_SU_filt":          [1,        0.7875,   0.915   ],
	"Pearl_SI_chat3":         [0.175,    0.05125,  0.2575  ],
	"Pearl_SI_chat4":         [0.175,    0.2575,   0.05125 ],
	"Pearl_SI_chat5":         [0.2575,   0.05125,  0.175   ],
	"Pearl_DM":               [0.963333, 0.933333, 0.326667],
	"Pearl_LC":               [0.15,     0.49,     0.1636  ],
	"Pearl_OE":               [0.616667, 0.463333, 0.83    ],
	"Pearl_MS":               [0.843333, 0.91,     0.38    ],
	"Pearl_RM":               [0.692157, 0.184314, 0.984314],
	"Pearl_Rivulet_stomach":  [0.65,     0.89,     0.683333],
	"Pearl_LC_second":        [0.76,     0.4,      0       ],
	"Pearl_CL":               [0.742157, 0.284314, 1       ],
	"Pearl_VS":               [0.765,    0.05,     0.96    ],
	"Pearl_BroadcastMisc":    [0.911111, 0.775,    0.822222]
};


/* * * Additional or Binary Format Enums * * */

/* * * These are commented on in format.txt * * */

const BingoEnum_CHARACTERS = [
	"Yellow",
	"White",
	"Red",
	"Gourmand",
	"Artificer",
	"Rivulet",
	"Spear",
	"Saint",
	"Sofanthiel",
	"Night",
]

const BingoEnum_CharToDisplayText = {
	"Yellow":     "Monk",
	"White":      "Survivor",
	"Red":        "Hunter",
	"Gourmand":   "Gourmand",
	"Artificer":  "Artificer",
	"Rivulet":    "Rivulet",
	"Spear":      "Spearmaster",
	"Saint":      "Saint",
	"Sofanthiel": "Inv",
	"Night":      "Nightcat"
};

const BingoEnum_CHALLENGES = [
	"BingoChallenge",
	"BingoAchievementChallenge",
	"BingoAllRegionsExcept",
	"BingoBombTollChallenge",
	"BingoCollectPearlChallenge",
	"BingoCraftChallenge",
	"BingoCreatureGateChallenge",
	"BingoCycleScoreChallenge",
	"BingoDamageChallenge",
	"BingoDepthsChallenge",
	"BingoDodgeLeviathanChallenge",
	"BingoDontUseItemChallenge",
	"BingoEatChallenge",
	"BingoEchoChallenge",
	"BingoEnterRegionChallenge",
	"BingoGlobalScoreChallenge",
	"BingoGreenNeuronChallenge",
	"BingoHatchNoodleChallenge",
	"BingoHellChallenge",
	"BingoItemHoardChallenge",
	"BingoKarmaFlowerChallenge",
	"BingoKillChallenge",
	"BingoMaulTypesChallenge",
	"BingoMaulXChallenge",
	"BingoNeuronDeliveryChallenge",
	"BingoNoNeedleTradingChallenge",
	"BingoNoRegionChallenge",
	"BingoPearlDeliveryChallenge",
	"BingoPearlHoardChallenge",
	"BingoPinChallenge",
	"BingoPopcornChallenge",
	"BingoRivCellChallenge",
	"BingoSaintDeliveryChallenge",
	"BingoSaintPopcornChallenge",
	"BingoStealChallenge",
	"BingoTameChallenge",
	"BingoTradeChallenge",
	"BingoTradeTradedChallenge",
	"BingoTransportChallenge",
	"BingoUnlockChallenge",
	"BingoVistaChallenge"
];

const BingoEnum_EXPFLAGS = {
	"LANTERN":   0x00000001,
	"MASK":      0x00000002,
	"BOMB":      0x00000004,
	"NEURON":    0x00000008,
	"BACKSPEAR": 0x00000010,
	"FLOWER":    0x00000020,
	"PASSAGE":   0x00000040,
	"SLOWTIME":  0x00000080,
	"SINGUBOMB": 0x00000100,
	"ELECSPEAR": 0x00000200,
	"DUALWIELD": 0x00000400,
	"EXPRESIST": 0x00000800,
	"EXPJUMP":   0x00001000,
	"CRAFTING":  0x00002000,
	"AGILITY":   0x00004000,
	"RIFLE":     0x00008000,
	"BLINDED":   0x00010000,
	"DOOMED":    0x00020000,
	"HUNTED":    0x00040000,
	"PURSUED":   0x00080000,
	"AURA":      0x00100000
};

const BingoEnum_EXPFLAGSNames = {
	"LANTERN":   "Perk: Scavenger Lantern",
	"MASK":      "Perk: Vulture Mask",
	"BOMB":      "Perk: Scavenger Bomb",
	"NEURON":    "Perk: Neuron Glow",
	"BACKSPEAR": "Perk: Back Spear",
	"FLOWER":    "Perk: Karma Flower",
	"PASSAGE":   "Perk: Enable Passages",
	"SLOWTIME":  "Perk: Slow Time",
	"SINGUBOMB": "Perk: Singularity Bomb",
	"ELECSPEAR": "Perk: Electric Spear",
	"DUALWIELD": "Perk: Spear Dual-Wielding",
	"EXPRESIST": "Perk: Explosion Resistance",
	"EXPJUMP":   "Perk: Explosive Jump",
	"CRAFTING":  "Perk: Item Crafting",
	"AGILITY":   "Perk: High Agility",
	"RIFLE":     "Perk: Joke Rifle",
	"BLINDED":   "Burden: Blinded",
	"DOOMED":    "Burden: Doomed",
	"HUNTED":    "Burden: Hunted",
	"PURSUED":   "Burden: Pursued",
	"AURA":      "Aura"
};

/**
 *	Boolean strings, for completeness.
 */
const BingoEnum_Boolean = [
	"false",
	"true"
];

/**
 *	Stock (built in / mod generated) Vista Point locations.
 */
const BingoEnum_VistaPoints = [
	//	Base Expedition
	{ region: "CC", room: "CC_A10",           x:  734, y:  506 },
	{ region: "CC", room: "CC_B12",           x:  455, y: 1383 },
	{ region: "CC", room: "CC_C05",           x:  449, y: 2330 },
	{ region: "CL", room: "CL_C05",           x:  540, y: 1213 },
	{ region: "CL", room: "CL_H02",           x: 2407, y: 1649 },
	{ region: "CL", room: "CL_CORE",          x:  471, y:  373 },
	{ region: "DM", room: "DM_LAB1",          x:  486, y:  324 },
	{ region: "DM", room: "DM_LEG06",         x:  400, y:  388 },
	{ region: "DM", room: "DM_O02",           x: 2180, y: 2175 },
	{ region: "DS", room: "DS_A05",           x:  172, y:  490 },
	{ region: "DS", room: "DS_A19",           x:  467, y:  545 },
	{ region: "DS", room: "DS_C02",           x:  541, y: 1305 },
	{ region: "GW", room: "GW_C09",           x:  607, y:  595 },
	{ region: "GW", room: "GW_D01",           x: 1603, y:  595 },
	{ region: "GW", room: "GW_E02",           x: 2608, y:  621 },
	{ region: "HI", room: "HI_B04",           x:  214, y:  615 },
	{ region: "HI", room: "HI_C04",           x:  800, y:  768 },
	{ region: "HI", room: "HI_D01",           x: 1765, y:  655 },
	{ region: "LC", room: "LC_FINAL",         x: 2700, y:  500 },
	{ region: "LC", room: "LC_SUBWAY01",      x: 1693, y:  564 },
	{ region: "LC", room: "LC_tallestconnection", x:  153, y:  242 },
	{ region: "LF", room: "LF_A10",           x:  421, y:  412 },
	{ region: "LF", room: "LF_C01",           x: 2792, y:  423 },
	{ region: "LF", room: "LF_D02",           x: 1220, y:  631 },
	{ region: "OE", room: "OE_RAIL01",        x: 2420, y: 1378 },
	{ region: "OE", room: "OE_RUINCourtYard", x: 2133, y: 1397 },
	{ region: "OE", room: "OE_TREETOP",       x:  468, y: 1782 },
	{ region: "RM", room: "RM_ASSEMBLY",      x: 1550, y:  586 },
	{ region: "RM", room: "RM_CONVERGENCE",   x: 1860, y:  670 },
	{ region: "RM", room: "RM_I03",           x:  276, y: 2270 },
	{ region: "SB", room: "SB_D04",           x:  483, y: 1045 },
	{ region: "SB", room: "SB_E04",           x: 1668, y:  567 },
	{ region: "SB", room: "SB_H02",           x: 1559, y:  472 },
	{ region: "SH", room: "SH_A14",           x:  273, y:  556 },
	{ region: "SH", room: "SH_B05",           x:  733, y:  453 },
	{ region: "SH", room: "SH_C08",           x: 2159, y:  481 },
	{ region: "SI", room: "SI_C07",           x:  539, y: 2354 },
	{ region: "SI", room: "SI_D05",           x: 1045, y: 1258 },
	{ region: "SI", room: "SI_D07",           x:  200, y:  400 },
	{ region: "SL", room: "SL_B01",           x:  389, y: 1448 },
	{ region: "SL", room: "SL_B04",           x:  390, y: 2258 },
	{ region: "SL", room: "SL_C04",           x:  542, y: 1295 },
	{ region: "SU", room: "SU_A04",           x:  265, y:  415 },
	{ region: "SU", room: "SU_B12",           x: 1180, y:  382 },
	{ region: "SU", room: "SU_C01",           x:  450, y: 1811 },
	{ region: "UG", room: "UG_A16",           x:  640, y:  354 },
	{ region: "UG", room: "UG_D03",           x:  857, y: 1826 },
	{ region: "UG", room: "UG_GUTTER02",      x:  163, y:  241 },
	{ region: "UW", room: "UW_A07",           x:  805, y:  616 },
	{ region: "UW", room: "UW_C02",           x:  493, y:  490 },
	{ region: "UW", room: "UW_J01",           x:  860, y: 1534 },
	{ region: "VS", room: "VS_C03",           x:   82, y:  983 },
	{ region: "VS", room: "VS_F02",           x: 1348, y:  533 },
	{ region: "VS", room: "VS_H02",           x:  603, y: 3265 },
	//	Bingo customs/adders
	{ region: "CC", room: "CC_SHAFT0x",       x: 1525, y:  217 },
	{ region: "CL", room: "CL_C03",           x:  808, y:   37 },
	{ region: "DM", room: "DM_VISTA",         x:  956, y:  341 },
	{ region: "DS", room: "DS_GUTTER02",      x:  163, y:  241 },
	{ region: "GW", room: "GW_A24",           x:  590, y:  220 },
	{ region: "HI", room: "HI_B02",           x:  540, y: 1343 },
	{ region: "LC", room: "LC_stripmallNEW",  x: 1285, y:   50 },
	{ region: "LF", room: "LF_E01",           x:  359, y:   63 },
	{ region: "LM", room: "LM_B01",           x:  248, y: 1507 },
	{ region: "LM", room: "LM_B04",           x:  503, y: 2900 },
	{ region: "LM", room: "LM_C04",           x:  542, y:  129 },
	{ region: "LM", room: "LM_EDGE02",        x: 1750, y: 1715 },
	{ region: "MS", room: "MS_AIR03",         x: 1280, y:  770 },
	{ region: "MS", room: "MS_ARTERY01",      x: 4626, y:   39 },
	{ region: "MS", room: "MS_FARSIDE",       x: 2475, y: 1800 },
	{ region: "MS", room: "MS_LAB4",          x:  390, y:  240 },
	{ region: "OE", room: "OE_CAVE02",        x: 1200, y:   35 },
	{ region: "RM", room: "RM_LAB8",          x: 1924, y:   65 },
	{ region: "SB", room: "SB_C02",           x: 1155, y:  550 },
	{ region: "SH", room: "SH_E02",           x:  770, y:   40 },
	{ region: "SI", room: "SI_C04",           x: 1350, y:  130 },
	{ region: "SL", room: "SL_AI",            x: 1530, y:   15 },
	{ region: "SS", room: "SS_A13",           x:  347, y:  595 },
	{ region: "SS", room: "SS_C03",           x:   60, y:  119 },
	{ region: "SS", room: "SS_D04",           x:  980, y:  440 },
	{ region: "SS", room: "SS_LAB12",         x:  697, y:  255 },
	{ region: "SU", room: "SU_B11",           x:  770, y:   48 },
	{ region: "UG", room: "UG_A19",           x:  545, y:   43 },
	{ region: "UW", room: "UW_D05",           x:  760, y:  220 },
	{ region: "VS", room: "VS_E06",           x:  298, y:  142 }
];

/**
 *	Stock (built in / mod generated) Vista Point locations, to drop into goal strings.
 *	Used by BingoVistaChallenge enum bin-to-string.  Of the form:
 *	"{0}><System.String|{1}|Room|0|vista><{2}><{3}"
 *	where {0} is the region code, {1} is the room name, {2} is the x-coordinate,
 *	and {3} the y-coordinate.
 */
const BingoEnum_VistaPoints_Code = [
	"CC><System.String|CC_A10|Room|0|vista><734><506",
	"CC><System.String|CC_B12|Room|0|vista><455><1383",
	"CC><System.String|CC_C05|Room|0|vista><449><2330",
	"CL><System.String|CL_C05|Room|0|vista><540><1213",
	"CL><System.String|CL_H02|Room|0|vista><2407><1649",
	"CL><System.String|CL_CORE|Room|0|vista><471><373",
	"DM><System.String|DM_LAB1|Room|0|vista><486><324",
	"DM><System.String|DM_LEG06|Room|0|vista><400><388",
	"DM><System.String|DM_O02|Room|0|vista><2180><2175",
	"DS><System.String|DS_A05|Room|0|vista><172><490",
	"DS><System.String|DS_A19|Room|0|vista><467><545",
	"DS><System.String|DS_C02|Room|0|vista><541><1305",
	"GW><System.String|GW_C09|Room|0|vista><607><595",
	"GW><System.String|GW_D01|Room|0|vista><1603><595",
	"GW><System.String|GW_E02|Room|0|vista><2608><621",
	"HI><System.String|HI_B04|Room|0|vista><214><615",
	"HI><System.String|HI_C04|Room|0|vista><800><768",
	"HI><System.String|HI_D01|Room|0|vista><1765><655",
	"LC><System.String|LC_FINAL|Room|0|vista><2700><500",
	"LC><System.String|LC_SUBWAY01|Room|0|vista><1693><564",
	"LC><System.String|LC_tallestconnection|Room|0|vista><153><242",
	"LF><System.String|LF_A10|Room|0|vista><421><412",
	"LF><System.String|LF_C01|Room|0|vista><2792><423",
	"LF><System.String|LF_D02|Room|0|vista><1220><631",
	"OE><System.String|OE_RAIL01|Room|0|vista><2420><1378",
	"OE><System.String|OE_RUINCourtYard|Room|0|vista><2133><1397",
	"OE><System.String|OE_TREETOP|Room|0|vista><468><1782",
	"RM><System.String|RM_ASSEMBLY|Room|0|vista><1550><586",
	"RM><System.String|RM_CONVERGENCE|Room|0|vista><1860><670",
	"RM><System.String|RM_I03|Room|0|vista><276><2270",
	"SB><System.String|SB_D04|Room|0|vista><483><1045",
	"SB><System.String|SB_E04|Room|0|vista><1668><567",
	"SB><System.String|SB_H02|Room|0|vista><1559><472",
	"SH><System.String|SH_A14|Room|0|vista><273><556",
	"SH><System.String|SH_B05|Room|0|vista><733><453",
	"SH><System.String|SH_C08|Room|0|vista><2159><481",
	"SI><System.String|SI_C07|Room|0|vista><539><2354",
	"SI><System.String|SI_D05|Room|0|vista><1045><1258",
	"SI><System.String|SI_D07|Room|0|vista><200><400",
	"SL><System.String|SL_B01|Room|0|vista><389><1448",
	"SL><System.String|SL_B04|Room|0|vista><390><2258",
	"SL><System.String|SL_C04|Room|0|vista><542><1295",
	"SU><System.String|SU_A04|Room|0|vista><265><415",
	"SU><System.String|SU_B12|Room|0|vista><1180><382",
	"SU><System.String|SU_C01|Room|0|vista><450><1811",
	"UG><System.String|UG_A16|Room|0|vista><640><354",
	"UG><System.String|UG_D03|Room|0|vista><857><1826",
	"UG><System.String|UG_GUTTER02|Room|0|vista><163><241",
	"UW><System.String|UW_A07|Room|0|vista><805><616",
	"UW><System.String|UW_C02|Room|0|vista><493><490",
	"UW><System.String|UW_J01|Room|0|vista><860><1534",
	"VS><System.String|VS_C03|Room|0|vista><82><983",
	"VS><System.String|VS_F02|Room|0|vista><1348><533",
	"VS><System.String|VS_H02|Room|0|vista><603><3265",
	"CC><System.String|CC_SHAFT0x|Room|0|vista><1525><217",
	"CL><System.String|CL_C03|Room|0|vista><808><37",
	"DM><System.String|DM_VISTA|Room|0|vista><956><341",
	"DS><System.String|DS_GUTTER02|Room|0|vista><163><241",
	"GW><System.String|GW_A24|Room|0|vista><590><220",
	"HI><System.String|HI_B02|Room|0|vista><540><1343",
	"LC><System.String|LC_stripmallNEW|Room|0|vista><1285><50",
	"LF><System.String|LF_E01|Room|0|vista><359><63",
	"LM><System.String|LM_B01|Room|0|vista><248><1507",
	"LM><System.String|LM_B04|Room|0|vista><503><2900",
	"LM><System.String|LM_C04|Room|0|vista><542><129",
	"LM><System.String|LM_EDGE02|Room|0|vista><1750><1715",
	"MS><System.String|MS_AIR03|Room|0|vista><1280><770",
	"MS><System.String|MS_ARTERY01|Room|0|vista><4626><39",
	"MS><System.String|MS_FARSIDE|Room|0|vista><2475><1800",
	"MS><System.String|MS_LAB4|Room|0|vista><390><240",
	"OE><System.String|OE_CAVE02|Room|0|vista><1200><35",
	"RM><System.String|RM_LAB8|Room|0|vista><1924><65",
	"SB><System.String|SB_C02|Room|0|vista><1155><550",
	"SH><System.String|SH_E02|Room|0|vista><770><40",
	"SI><System.String|SI_C04|Room|0|vista><1350><130",
	"SL><System.String|SL_AI|Room|0|vista><1530><15",
	"SS><System.String|SS_A13|Room|0|vista><347><595",
	"SS><System.String|SS_C03|Room|0|vista><60><119",
	"SS><System.String|SS_D04|Room|0|vista><980><440",
	"SS><System.String|SS_LAB12|Room|0|vista><697><255",
	"SU><System.String|SU_B11|Room|0|vista><770><48",
	"UG><System.String|UG_A19|Room|0|vista><545><43",
	"UW><System.String|UW_D05|Room|0|vista><760><220",
	"VS><System.String|VS_E06|Room|0|vista><298><142"
];

const BingoEnum_EnterableGates = [
	"SU_HI", "SU_LF", "SU_DS", "HI_SU",
	"HI_CC", "HI_SH", "HI_GW", "HI_VS",
	"VS_HI", "VS_SI", "VS_SL", "VS_SB",
	"GW_HI", "GW_SL", "GW_DS", "SL_GW",
	"SL_SB", "SL_SH", "SL_VS", "SH_GW",
	"SH_HI", "SH_UW", "SH_SL", "UW_SH",
	"UW_SL", "UW_CC", "CC_UW", "CC_HI",
	"CC_DS", "CC_SI", "LF_SU", "LF_SI",
	"LF_SB", "SI_LF", "SI_CC", "SI_VS",
	"DS_SU", "DS_SB", "DS_GW", "DS_CC",
	"SB_DS", "SB_SL", "SB_VS"
];

/**
 *	Master list/map of all enums used.
 *	Key type: list name, as used in Bingo Mod SettingBox lists.
 *	Value type: array of strings, set of creature/item internal names, tokens, region codes, etc.
 */
const ALL_ENUMS = {
	"creatures":      ["Any Creature"].concat(Object.keys(creatureNameToDisplayTextMap)),
	"items":          Object.keys(itemNameToDisplayTextMap),
	"pearls":         DataPearlList.slice(2),
	"depths":         BingoEnum_Depthable,
	"expobject":      BingoEnum_expobject,
	"craft":          BingoEnum_CraftableItems,
	"banitem":        BingoEnum_FoodTypes.concat(BingoEnum_Bannable),
	"food":           BingoEnum_FoodTypes,
	"theft":          BingoEnum_theft,
	"friend":         BingoEnum_Befriendable,
	"transport":      BingoEnum_Transportable,
	"tolls":          BingoEnum_BombableOutposts,
	"pinnable":       BingoEnum_Pinnable,
	"weapons":        BingoEnum_Weapons,
	"weaponsnojelly": BingoEnum_Weapons,
	"regions":        BingoEnum_AllRegionCodes,
	"regionsreal":    BingoEnum_AllRegionCodes,
	"subregions":     BingoEnum_AllSubregions,
	"echoes":         BingoEnum_AllRegionCodes,
	"unlocks":        BingoEnum_AllUnlocks,
	"passage":        Object.keys(passageToDisplayNameMap),
	"characters":     BingoEnum_CHARACTERS,
	"EXPFLAGS":       Object.keys(BingoEnum_EXPFLAGS),
	"challenges":     BingoEnum_CHALLENGES,
	"boolean":        BingoEnum_Boolean,
	"vista_code":     BingoEnum_VistaPoints_Code
};

/**
 *	Instructions for producing text goals.  Index with BingoEnum_CHALLENGES.
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
 *	may happen.
 *
 *	The final goal string is produced as "<name>~<desc>", with desc's template sites
 *	replaced by values produced from respectively numbered params items.  Goals are
 *	joined with "bChG" to produce a complete board.
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
 *	//	Plain string: copies a fixed-length or ASCIIZ string into its replacement template site(s)
 *	{
 *		type: "string",
 *		offset: 3,      	//	byte offset to read from
 *		size: 2,        	//	number of bytes to read, or if 0, read until zero terminator or end of goal
 *		formatter: "",  	//	Name of an enum to transform each character with
 *		joiner: ""      	//	String to join characters with
 *	}
 *
 *	//	Pointer to string: reads a (byte) offset from target location, then copies, from
 *	//	that offset (relative to goal data start), a fixed-length or ASCIIZ string into
 *	//	its replacement template site(s)
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
 *	Special note: because zero may be used for string terminator, and because enums may be
 *	used for both string (array) and scalar (number) data, the actual enum index written is
 *	someEnumArray.indexOf("someString") + 1 for either type of data.  Enums with a default
 *	or "any" value shall have that value at index 0 (thus, stored as 1 in the binary format).
 *
 *	Note that the last string in a goal can be terminated by the goal object itself, saving
 *	a zero terminator.  Ensure that an implementation captures this behavior safely, without
 *	committing read-beyond-bounds or uninitialized memory access.  A recommended approach
 *	is copying the goal into a temporary buffer, that has been zeroed at least some bytes
 *	beyond the length of the goal being read.  Or use a language which returns zero or null
 *	or throws error for OoB reads.
 */
const BINARY_TO_STRING_DEFINITIONS = [
	{	//	Base class: no parameters, any desc allowed
		name: "BingoChallenge",
		params: [
			{	//	0: Unformatted string
				type: "string",
				offset: 0,
				size: 0,
				formatter: ""
			}
		],
		desc: "{0}><"
	},
	{
		name: "BingoAchievementChallenge",
		params: [
			{	//	0: Passage choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "passage"
			}
		],
		desc: "System.String|{0}|Passage|0|passage><0><0"
	},
	{
		name: "BingoAllRegionsExcept",
		params: [
			{	//	0: Excluded region choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "regionsreal"
			},
			{	//	1: Remaining region count
				type: "number",
				offset: 1,
				size: 1,
				formatter: ""
			},
			{	//	2: Remaining regions list
				type: "string",
				offset: 2,
				size: 0,
				formatter: "regionsreal",
				joiner: "|"
			}
		],
		desc: "System.String|{0}|Region|0|regionsreal><{2}><0><{1}><0><0"
	},
	{
		name: "BingoBombTollChallenge",
		params: [
			{	//	0: Toll choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "tolls"
			},
			{	//	1: Pass Toll flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "boolean"
			}
		],
		desc: "System.String|{0}|Scavenger Toll|1|tolls><System.Boolean|{1}|Pass the Toll|0|NULL><0><0"
	},
	{
		name: "BingoCollectPearlChallenge",
		params: [
			{	//	0: Specific Pearl flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "boolean"
			},
			{	//	1: Pearl choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "pearls",
			},
			{	//	2: Item amount
				type: "number",
				offset: 1,
				size: 2,
				formatter: "",
			}
		],
		desc: "System.Boolean|{0}|Specific Pearl|0|NULL><System.String|{1}|Pearl|1|pearls><0><System.Int32|{2}|Amount|3|NULL><0><0><"
	},
	{
		name: "BingoCraftChallenge",
		params: [
			{	//	0: Item choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "craft",
			},
			{	//	1: Item amount
				type: "number",
				offset: 1,
				size: 2,
				formatter: "",
			}
		],
		desc: "System.String|{0}|Item to Craft|0|craft><System.Int32|{1}|Amount|1|NULL><0><0><0"
	},
	{
		name: "BingoCreatureGateChallenge",
		params: [
			{	//	0: Creature choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "transport",
			},
			{	//	1: Gate amount
				type: "number",
				offset: 1,
				size: 1,
				formatter: "",
			}
		],
		desc: "System.String|{0}|Creature Type|1|transport><0><System.Int32|{1}|Amount|0|NULL><empty><0><0"
	},
	{
		name: "BingoCycleScoreChallenge",
		params: [
			{	//	0: Score amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: "",
			}
		],
		desc: "System.Int32|{0}|Target Score|0|NULL><0><0"
	},
	{
		name: "BingoDamageChallenge",
		params: [
			{	//	0: Item choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "weapons",
			},
			{	//	1: Creature choice
				type: "number",
				offset: 1,
				size: 1,
				formatter: "creatures",
			},
			{	//	2: Score amount
				type: "number",
				offset: 2,
				size: 2,
				formatter: "",
			}
		],
		desc: "System.String|{0}|Weapon|0|weapons><System.String|{1}|Creature Type|1|creatures><0><System.Int32|{2}|Amount|2|NULL><0><0"
	},
	{
		name: "BingoDepthsChallenge",
		params: [
			{	//	0: Creature choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "depths",
			}
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
			{	//	0: Item choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "banitem",
			},
			{	//	1: Pass Toll flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: ""
			},
			{	//	2: isCreature flag
				type: "bool",
				offset: 0,
				bit: 5,
				formatter: ""
			}
		],
		desc: "System.String|{0}|Item type|0|banitem><{1}><0><0><{2}"
	},
	{
		name: "BingoEatChallenge",
		params: [
			{	//	0: Item amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: "",
			},
			{	//	1: Creature flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "",
			},
			{	//	2: Item choice
				type: "number",
				offset: 2,
				size: 1,
				formatter: "food",
			}
		],
		desc: "System.Int32|{0}|Amount|1|NULL><0><{1}><System.String|{2}|Food type|0|food><0><0"
	},
	{
		name: "BingoEchoChallenge",
		params: [
			{	//	0: Echo choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "echoes",
			},
			{	//	1: Starving flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "boolean",
			}
		],
		desc: "System.String|{0}|Region|0|echoes><System.Boolean|{1}|While Starving|1|NULL><0><0"
	},
	{
		name: "BingoEnterRegionChallenge",
		params: [
			{	//	0: Region choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "regionsreal",
			}
		],
		desc: "System.String|{0}|Region|0|regionsreal><0><0"
	},
	{
		name: "BingoGlobalScoreChallenge",
		params: [
			{	//	0: Score amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: "",
			}
		],
		desc: "0><System.Int32|{0}|Target Score|0|NULL><0><0"
	},
	{
		name: "BingoGreenNeuronChallenge",
		params: [
			{	//	0: Moon flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "boolean",
			}
		],
		desc: "System.Boolean|{0}|Looks to the Moon|0|NULL><0><0"
	},
	{
		name: "BingoHatchNoodleChallenge",
		params: [
			{	//	0: Hatch amount
				type: "number",
				offset: 0,
				size: 1,
				formatter: "",
			},
			{	//	1: At Once flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "boolean",
			}
		],
		desc: "0><System.Int32|{0}|Amount|1|NULL><System.Boolean|{1}|At Once|0|NULL><0><0"
	},
	{
		name: "BingoHellChallenge",
		params: [
			{	//	0: Squares amount
				type: "number",
				offset: 0,
				size: 1,
				formatter: "",
			}
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoItemHoardChallenge",
		params: [
			{	//	0: Item amount
				type: "number",
				offset: 0,
				size: 1,
				formatter: "",
			},
			{	//	1: Item choice
				type: "number",
				offset: 1,
				size: 1,
				formatter: "expobject",
			}
		],
		desc: "System.Int32|{0}|Amount|1|NULL><System.String|{1}|Item|0|expobject><0><0"
	},
	{
		name: "BingoKarmaFlowerChallenge",
		params: [
			{	//	0: Item amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: "",
			}
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoKillChallenge",
		params: [
			{	//	0: Creature choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "creatures"
			},
			{	//	1: Item choice
				type: "number",
				offset: 1,
				size: 1,
				formatter: "weaponsnojelly"
			},
			{	//	2: Kill amount
				type: "number",
				offset: 2,
				size: 2,
				formatter: ""
			},
			{	//	3: Region choice
				type: "number",
				offset: 4,
				size: 1,
				formatter: "regions"
			},
			{	//	4: Subregion choice
				type: "number",
				offset: 5,
				size: 1,
				formatter: "subregions"
			},
			{	//	5: One Cycle flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "boolean"
			},
			{	//	6: Death Pit flag
				type: "bool",
				offset: 0,
				bit: 5,
				formatter: "boolean"
			},
			{	//	7: Starving flag
				type: "bool",
				offset: 0,
				bit: 6,
				formatter: "boolean"
			},
		],
		desc: "System.String|{0}|Creature Type|0|creatures><System.String|{1}|Weapon Used|6|weaponsnojelly><System.Int32|{2}|Amount|1|NULL><0><System.String|{3}|Region|5|regions><System.String|{4}|Subregion|4|subregions><System.Boolean|{5}|In one Cycle|3|NULL><System.Boolean|{6}|Via a Death Pit|7|NULL><System.Boolean|{7}|While Starving|2|NULL><0><0"
	},
	{
		name: "BingoMaulTypesChallenge",
		params: [
			{	//	0: Item amount
				type: "number",
				offset: 0,
				size: 1,	//	Skimping on number size, but it's basically limited to ALL_ENUMS["creatures"]
				formatter: ""
			},
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0><"
	},
	{
		name: "BingoMaulXChallenge",
		params: [
			{	//	0: Item amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: ""
			},
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoNeuronDeliveryChallenge",
		params: [
			{	//	0: Item amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: ""
			},
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
			{	//	0: Region choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "regionsreal"
			},
		],
		desc: "System.String|{0}|Region|0|regionsreal><0><0"
	},
	{
		name: "BingoPearlDeliveryChallenge",
		params: [
			{	//	0: Region choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "regions"
			},
		],
		desc: "System.String|{0}|Pearl from Region|0|regions><0><0"
	},
	{
		name: "BingoPearlHoardChallenge",
		params: [
			{	//	0: Common Pearls flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "boolean"
			},
			{	//	1: Item amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: ""
			},
			{	//	2: Region choice
				type: "number",
				offset: 2,
				size: 1,
				formatter: "regions"
			}
		],
		desc: "System.Boolean|{0}|Common Pearls|0|NULL><System.Int32|{1}|Amount|1|NULL><System.String|{2}|In Region|2|regions><0><0"
	},
	{
		name: "BingoPinChallenge",
		params: [
			{	//	0: Pin amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: ""
			},
			{	//	1: Creature choice
				type: "number",
				offset: 2,
				size: 1,
				formatter: "creatures"
			},
			{	//	2: Region choice
				type: "number",
				offset: 3,
				size: 1,
				formatter: "regions"
			}
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><System.String|{1}|Creature Type|1|creatures><><System.String|{2}|Region|2|regions><0><0"
	},
	{
		name: "BingoPopcornChallenge",
		params: [
			{	//	0: Item amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: ""
			},
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
			{	//	0: Item amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: ""
			}
		],
		desc: "0><System.Int32|{0}|Amount|0|NULL><0><0"
	},
	{
		name: "BingoStealChallenge",
		params: [
			{	//	0: Item choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "theft"
			},
			{	//	1: From Toll flag
				type: "bool",
				offset: 0,
				bit: 4,
				formatter: "boolean"
			},
			{	//	2: Steal amount
				type: "number",
				offset: 1,
				size: 2,
				formatter: ""
			}
		],
		desc: "System.String|{0}|Item|1|theft><System.Boolean|{1}|From Scavenger Toll|0|NULL><0><System.Int32|{2}|Amount|2|NULL><0><0"
	},
	{
		name: "BingoTameChallenge",
		params: [
			{	//	0: Creature choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "friend"
			}
		],
		desc: "System.String|{0}|Creature Type|0|friend><0><0"
	},
	{
		name: "BingoTradeChallenge",
		params: [
			{	//	0: Trade points amount
				type: "number",
				offset: 0,
				size: 2,
				formatter: ""
			}
		],
		desc: "0><System.Int32|{0}|Value|0|NULL><0><0"
	},
	{
		name: "BingoTradeTradedChallenge",
		params: [
			{	//	0: Trade item amount
				type: "number",
				offset: 0,
				size: 2,	//	65k is a preposterous amount of items to allow, but... just in case?
				formatter: ""
			}
		],
		desc: "0><System.Int32|{0}|Amount of Items|0|NULL><empty><0><0"
	},
	{
		name: "BingoTransportChallenge",
		params: [
			{	//	0: From Region choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "regions"
			},
			{	//	1: To Region choice
				type: "number",
				offset: 1,
				size: 1,
				formatter: "regions"
			},
			{	//	2: Creature choice
				type: "number",
				offset: 2,
				size: 1,
				formatter: "transport"
			}
		],
		desc: "System.String|{0}|From Region|0|regions><System.String|{1}|To Region|1|regions><System.String|{2}|Creature Type|2|transport><><0><0"
	},
	{
		name: "BingoUnlockChallenge",
		params: [
			{	//	0: Unlock token choice
				type: "number",
				offset: 0,
				size: 2,	//	Bigger than needed, but future-proofing as it's a pretty big list already...
				formatter: "unlocks"
			}
		],
		desc: "System.String|{0}|Unlock|0|unlocks><0><0"
	},
	{
		name: "BingoVistaChallenge",
		params: [
			{	//	0: Region choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "regions"
			},
			{	//	1: Room name (verbatim)
				type: "string",
				offset: 5,
				size: 0,	//	Read to zero terminator or end of goal
				formatter: "",
				joiner: ""
			},
			{	//	2: Room X coordinate (decimal)
				type: "number",
				offset: 1,
				size: 2,
				formatter: ""
			},
			{	//	3: Room Y coordinate (decimal)
				type: "number",
				offset: 3,
				size: 2,
				formatter: ""
			}
		],
		desc: "{0}><System.String|{1}|Room|0|vista><{2}><{3}><0><0"
	},
	{	/*  Alternate enum version for as-generated locations; to index, use indexOf(name == "BingoVistaChallenge") + 1  */
		name: "BingoVistaChallenge",
		params: [
			{	//	0: Vista Point choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "vista_code"
			}
		],
		desc: "{0}><0><0"
	},
	{
		name: "BingoEnterRegionFromChallenge",
		params: [
			{	//	0: From regions choice
				type: "number",
				offset: 0,
				size: 1,
				formatter: "regionsreal"
			},
			{	//	1: To regions choice
				type: "string",
				offset: 1,
				size: 1,
				formatter: "regionsreal",
			}
		],
		desc: "System.String|{0}|From|0|regionsreal><System.String|{1}|To|0|regionsreal><0><0"
	},
];


/* * * Utility Functions * * */


/**
 *	Converts a string in the given shorthand named enum to its binary stored value.
 */
function enumToValue(s, en) {
	return ALL_ENUMS[en].indexOf(s) + 1;
}

/**
 *	Finds a string in the BingoEnum_CHALLENGES enum and converts to its binary
 *	value/index (the first selection from BINARY_TO_STRING_DEFINITIONS).
 *	Returns -1 if not found.
 */
function challengeValue(s) {
	return BINARY_TO_STRING_DEFINITIONS.findIndex(a => a.name == s);
}

/**
 *	Apply a boolean (1 bit) to the array at given offset and bit position.
 *	a     array of length at least offs
 *	offs  offset to apply at
 *	bit   bit position to apply to
 *	n     integer to apply, little-endian, unsigned
 */
function applyBool(a, offs, bit, bool) {
	a[offs] &= ~(1 << bit);
	if (bool == ALL_ENUMS["boolean"][0]) return;
	a[offs] |= (1 << bit);
}

/**
 *	Apply a short integer (WORD) to the array at given offset.
 *	a     array of length at least offs + 2
 *	offs  offset to apply at
 *	n     integer to apply, little-endian, unsigned
 */
function applyShort(a, offs, n) {
	a[offs] = (n >>> 0) & 0xff; a[offs + 1] = (n >>> 8) & 0xff;
}

/**
 *	Apply a long integer (DWORD) to the array at given offset.
 *	a     array of length at least offs + 4
 *	offs  offset to apply at
 *	n     integer to apply, little-endian, unsigned
 */
function applyLong(a, offs, n) {
	a[offs + 0] = (n >>>  0) & 0xff; a[offs + 1] = (n >>>  8) & 0xff;
	a[offs + 2] = (n >>> 16) & 0xff; a[offs + 3] = (n >>> 24) & 0xff;
}

/**
 *	Read a short integer (WORD) from the array at given offset.
 *	a     array of length at least offs + 2
 *	offs  offset to apply at
 *	returns: unsigned, little-endian
 */
function readShort(a, offs) {
	return (a[offs] << 0) + (a[offs + 1] << 8);
}

/**
 *	Read a long integer (DWORD) from the array at given offset.
 *	a     array of length at least offs + 4
 *	offs  offset to apply at
 *	returns: unsigned, little-endian
 */
function readLong(a, offs) {
	return (a[offs] << 0) + (a[offs + 1] << 8) + (a[offs + 2] << 16) + (a[offs + 3] << 24);
}

/**
 *	Check if the specified challenge descriptor SettingBox string matches
 *	the asserted value.  Helper function for CHALLENGES functions.
 *	@param t    string, name of calling object/junction
 *	@param d    string to parse and verify (e.g. "System.String|selectedItem|LabelText|itemIndex|list")
 *	@param f    array of values to compare to; length must match, empty elements are ignored
 *	@param err  string, text to include in the error
 *	@throws TypeError if invalid
 */
function checkSettingbox(t, d, f, err) {
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
 *	Check if the specified challenge descriptor matches the asserted value.
 *	Helper function for CHALLENGES functions.
 *	@param t    string, name of calling object/junction
 *	@param d    value to check equality of
 *	@param g    value comparing to
 *	@param err  string, text to include in the error
 *	@throws TypeError on mismatch
 */
function checkDescriptors(t, d, g, err) {
	var s = String(d), h = String(g);
	if (typeof(d) === "string") s = "\"" + s + "\"";
	if (typeof(g) === "string") h = "\"" + h + "\"";
	if (d != g) throw new TypeError(t + ": error, " + err + " " + s + ", expected: " + h);
}

/**
 *	Generate a valid? link to the RW map viewer, of the specified room,
 *	and current global state (board.character, map_link_base).
 */
function getMapLink(room) {
	if (map_link_base == "")
		return "";
	var reg = regionOfRoom(room);
	var ch = Object.keys(BingoEnum_CharToDisplayText)[
			Object.values(BingoEnum_CharToDisplayText).indexOf(board.character)] || "White";
	ch = ch.toLowerCase();
	return "<br><a href=\"" + map_link_base + "?slugcat=" + ch + "&region=" + reg + "&room=" + room
			+ "\" target=\"_blank\">" + room + " on Rain World Downpour Map" + "</a>";
}

/**
 *	Extract region code from given room code string.
 *	All extant regions follow this pattern, so, probably safe enough?
 */
function regionOfRoom(r) {
	return r.substring(0, r.search("_"));
}

/**
 *	Sets header mod information from the provided array:
 *	m = [
 *		{ name: "mod name", hash: "caf3bab3" },
 *		...
 *	]
 */
function addModsToHeader(m) {
	var elem = document.getElementById(ids.metamods);
	while (elem.childNodes.length) elem.removeChild(elem.childNodes[0]);
	if (!m.length) {
		elem.appendChild(document.createTextNode("none"));
		return;
	}
	var td = document.createElement("td");
	var tr = document.createElement("tr");
	var tbl = document.createElement("table");
	td.appendChild(document.createTextNode("Number"));
	tr.appendChild(td);
	td = document.createElement("td");
	td.appendChild(document.createTextNode("Hash"));
	tr.appendChild(td);
	td = document.createElement("td");
	td.appendChild(document.createTextNode("Name"));
	tr.appendChild(td);
	tbl.appendChild(tr); elem.appendChild(tbl);
	for (var i = 0; i < m.length; i++) {
		tr = document.createElement("tr");
		tbl.appendChild(tr);
		td = document.createElement("td");
		td.appendChild(document.createTextNode(String(i)));
		td.style.textAlign = "center";
		tr.appendChild(td);
		td = document.createElement("td");
		td.appendChild(document.createTextNode(m[i].hash));
		tr.appendChild(td);
		td = document.createElement("td");
		td.appendChild(document.createTextNode(m[i].name));
		tr.appendChild(td);
	}
}

/**
 *	Quickly sets the meta / header data for a parsed text board.
 *	Has no effect if the header table is not yet placed.
 *	@param comm   String to set as comment / title
 *	  character   Selected character; one of Object.values(BingoEnum_CharToDisplayText), or "Any" if other
 *	    shelter   Shelter to start in, or "" if random.
 *	      perks   List of perks to enable.  Array of integers, each indexing ALL_ENUMS.EXPFLAGS[]
 *	              and respective enums (see also BingoEnum_EXPFLAGSNames).
 *	              For example, the list [0, 5, 13, 14, 16] would enable:
 *	              "Perk: Scavenger Lantern", "Perk: Karma Flower", "Perk: Item Crafting",
 *	              "Perk: High Agility", "Burden: Blinded"
 *	              (Ordering of this array is not checked, and repeats are ignored.)
 *	Parameters are optional; an absent parameter leaves the existing value alone.
 *	Call with no parameters to get usage.
 */
function setMeta() {
	var comm = arguments[0], character = arguments[1];
	var shelter = arguments[2], perks = arguments[3];

	if (board === undefined || document.getElementById(ids.metatitle) === null
			|| document.getElementById(ids.charsel) === null
			|| document.getElementById(ids.shelter) === null) {
		console.log("Need a board to set.");
		return;
	}

	if (comm !== undefined)
		document.getElementById(ids.metatitle).innerText = comm;
	if (character !== undefined)
		document.getElementById(ids.charsel).value = character;
	if (shelter !== undefined) {
		if (shelter == "random") shelter = "";
		document.getElementById(ids.shelter).innerText = shelter;
	}
	if (perks !== undefined) {
		for (var i = 0, el; i < Object.values(BingoEnum_EXPFLAGS).length; i++) {
			el = document.getElementById(ids.perks + String(i));
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
		parseText();
		return;
	}
	console.log("setMeta(comm, character, shelter, perks)\n"
	          + "Quickly sets the meta / header data for a parsed text board.\n"
	          + "     comm   String to set as comment / title\n"
	          + "character   Selected character; one of Object.values(BingoEnum_CharToDisplayText), or \"Any\" if other.\n"
	          + "  shelter   Shelter to start in, or \"\" if random.\n"
	          + "    perks   List of perks to enable.  Array of integers, each indexing ALL_ENUMS.EXPFLAGS[] and\n"
	          + "respective enums (e.g. BingoEnum_EXPFLAGSNames). For example, the list [0, 5, 13, 14, 16] would\n"
	          + "enable: \"Perk: Scavenger Lantern\", \"Perk: Karma Flower\", \"Perk: Item Crafting\", \"Perk: High Agility\",\n"
	          + "\"Burden: Blinded\". (Ordering of this array is not checked, and repeats are ignored.)\n"
	          + "Parameters are optional; an absent parameter leaves the existing value alone. Call with no parameters\n"
	          + "to get usage.\n"
	          + "Example:  setMeta(\"New Title\", \"White\", \"SU_S05\", [])\n"
	          + "> sets the title, character and shelter, and clears perks.\n"
	);
}

function enumeratePerks() {
	var a = [];
	for (var i = 0, el; i < Object.values(BingoEnum_EXPFLAGS).length; i++) {
		el = document.getElementById(ids.perks + String(i));
		if (el !== null) {
			if (el.checked)
				a.push(i);
		} else
			break;
	}
	return a;
}

function compressionRatio() {
	return Math.round(1000 - 1000 * board.toBin.length / document.getElementById(ids.textbox).value.length) / 10;
}

function itemToColor(i) {
	var colr = itemNameToIconColorMap[i] || itemNameToIconColorMap["Default"];
	return colorFloatToString(colr);
}

function creatureToColor(c) {
	var colr = creatureNameToIconColorMap[c] || creatureNameToIconColorMap["Default"];
	return colorFloatToString(colr);
}

/**
 *	Convert floating point triple to HTML color string.
 */
function colorFloatToString(colr) {
	var r = colr[0], g = colr[1], b = colr[2];
	return "#" + ("00000" + (
			(toInt(r) << 16) + (toInt(g) << 8) + toInt(b)
		).toString(16)).slice(-6);

	function toInt(x) {
		return Math.min(255, Math.max(0, Math.floor(x * 256)));
	}
}

/**
 *	Grabbed from RWCustom.Custom::HSL2RGB
 */
function HSL2RGB(h, s, l) {
	var r = l;
	var g = l;
	var b = l;
	var num = (l <= 0.5) ? (l * (1 + s)) : (l + s - l * s);
	if (num > 0) {
		var num2 = l + l - num;
		var num3 = (num - num2) / num;
		h *= 6;
		var num4 = Math.floor(h);
		var num5 = h - num4;
		var num6 = num * num3 * num5;
		var num7 = num2 + num6;
		var num8 = num - num6;
		switch (num4) {
		case 0:
			r = num;
			g = num7;
			b = num2;
			break;
		case 1:
			r = num8;
			g = num;
			b = num2;
			break;
		case 2:
			r = num2;
			g = num;
			b = num7;
			break;
		case 3:
			r = num2;
			g = num8;
			b = num;
			break;
		case 4:
			r = num7;
			g = num2;
			b = num;
			break;
		case 5:
			r = num;
			g = num2;
			b = num8;
			break;
		}
	}
	return [r, g, b];
}

/**
 *	Default: for n != 1, concatenates number, space, name.
 *	For n == 1, tests for special cases (ref: creatureNameToDisplayTextMap,
 *	itemNameToDisplayTextMap), converting it to the English singular case
 *	("a Batfly", etc.).
 */
function creatureNameQuantify(n, s) {
	if (n != 1)
		return String(n) + " " + s;
	s = s.replace(/Mice$/, "Mouse").replace(/ies$/, "y").replace(/ches$/, "ch").replace(/s$/, "");
	if (/^[AEIOU]/i.test(s))
		s = "an " + s;
	else
		s = "a " + s;
	return s;
}

/**
 *	Helper functions to generate below tables.
 *	Convert creature value string to atlas name string.
 *	Ported from game/mod.
 *	TODO?: Throws if key not found (currently returns "Futile_White" game default)
 *	TODO?: refactor to associative array (convert ifs, ||s into more properties?
 *	    minor manual edit overhead)
 *	--> done
 */
function creatureNameToIconAtlas(type) {
	/*
	 *	Game extract: CreatureSymbol::SpriteNameOfCreature
	 *	Paste in verbatim, then make these changes:
	 *	- Adjust tabbing level to current scope
	 *	- Search and replace:
	 *		/CreatureTemplate\.Type\.|MoreSlugcatsEnums\.CreatureTemplateType\./ --> "\""
	 *		/iconData\.critType/ --> "type"
	 *		/\)\r\n\t{1,2}\{\r\n\t{2,3}/ --> "\"\)\r\n\t\t"
	 *		/\t{1,2}\}\r\n\t{1,2}if/ --> "\tif"
	 *		/\s\|\|\s/ --> "\" || "
	 *	- Remove MSC sub-clause
	 *	- Centipede clause: changed to use default index 2, since Bingo doesn't
	 *		distinguish between centipede sizes
	 *	- Yes, using regex on code is messy, inspect the results!  Don't be a dummy!
	 *	- Assumes CreatureTemplate enums use symbols equal to string contents; this appears to
	 *		always be the case, but may vary with future updates, or modded content.  Beware!
	 */
	if (type == "Slugcat")
		return "Kill_Slugcat";
	if (type == "GreenLizard")
		return "Kill_Green_Lizard";
	if (type == "PinkLizard" || type == "BlueLizard" || type == "CyanLizard" || type == "RedLizard")
		return "Kill_Standard_Lizard";
	if (type == "WhiteLizard")
		return "Kill_White_Lizard";
	if (type == "BlackLizard")
		return "Kill_Black_Lizard";
	if (type == "YellowLizard")
		return "Kill_Yellow_Lizard";
	if (type == "Salamander")
		return "Kill_Salamander";
	if (type == "Scavenger")
		return "Kill_Scavenger";
	if (type == "Vulture")
		return "Kill_Vulture";
	if (type == "KingVulture")
		return "Kill_KingVulture";
	if (type == "CicadaA" || type == "CicadaB")
		return "Kill_Cicada";
	if (type == "Snail")
		return "Kill_Snail";
	if (type == "Centiwing")
		return "Kill_Centiwing";
	if (type == "SmallCentipede")
		return "Kill_Centipede1";
	if (type == "Centipede")
		return "Kill_Centipede2";
	if (type == "RedCentipede")
		return "Kill_Centipede3";
	if (type == "BrotherLongLegs" || type == "DaddyLongLegs")
		return "Kill_Daddy";
	if (type == "LanternMouse")
		return "Kill_Mouse";
	if (type == "GarbageWorm")
		return "Kill_Garbageworm";
	if (type == "Fly")
		return "Kill_Bat";
	if (type == "Leech" || type == "SeaLeech")
		return "Kill_Leech";
	if (type == "Spider")
		return "Kill_SmallSpider";
	if (type == "JetFish")
		return "Kill_Jetfish";
	if (type == "BigEel")
		return "Kill_BigEel";
	if (type == "Deer")
		return "Kill_RainDeer";
	if (type == "TubeWorm")
		return "Kill_Tubeworm";
	if (type == "TentaclePlant")
		return "Kill_TentaclePlant";
	if (type == "PoleMimic")
		return "Kill_PoleMimic";
	if (type == "MirosBird")
		return "Kill_MirosBird";
	if (type == "Overseer")
		return "Kill_Overseer";
	if (type == "VultureGrub")
		return "Kill_VultureGrub";
	if (type == "EggBug")
		return "Kill_EggBug";
	if (type == "BigSpider" || type == "SpitterSpider")
		return "Kill_BigSpider";
	if (type == "BigNeedleWorm")
		return "Kill_NeedleWorm";
	if (type == "SmallNeedleWorm")
		return "Kill_SmallNeedleWorm";
	if (type == "DropBug")
		return "Kill_DropBug";
	if (type == "Hazer")
		return "Kill_Hazer";
	if (type == "TrainLizard")
		return "Kill_Standard_Lizard";
	if (type == "ZoopLizard")
		return "Kill_White_Lizard";
	if (type == "EelLizard")
		return "Kill_Salamander";
	if (type == "JungleLeech")
		return "Kill_Leech";
	if (type == "TerrorLongLegs")
		return "Kill_Daddy";
	if (type == "MotherSpider")
		return "Kill_BigSpider";
	if (type == "StowawayBug")
		return "Kill_Stowaway";
	if (type == "HunterDaddy")
		return "Kill_Slugcat";
	if (type == "FireBug")
		return "Kill_FireBug";
	if (type == "AquaCenti")
		return "Kill_Centiwing";
	if (type == "MirosVulture")
		return "Kill_MirosBird";
	if (type == "FireBug")	//	bug in original code, extraneous clause left in, and not optimized out
		return "Kill_EggBug";
	if (type == "ScavengerElite")
		return "Kill_ScavengerElite";
	if (type == "ScavengerKing")
		return "Kill_ScavengerKing";
	if (type == "SpitLizard")
		return "Kill_Spit_Lizard";
	if (type == "Inspector")
		return "Kill_Inspector";
	if (type == "Yeek")
		return "Kill_Yeek";
	if (type == "BigJelly")
		return "Kill_BigJellyFish";
	if (type == "SlugNPC")
		return "Kill_Slugcat";
	return "Futile_White";
}

/**
 *	Helper functions to generate below tables.
 *	Convert creature value string to HTML color.
 *	Converts item value string to HTML color; ported from game/mod.
 *	TODOs: same as creatureNameToIconAtlas().
 */
function creatureNameToIconColor(type) {
	//	values excerpted from LizardBreeds::BreedTemplate; returns array [r, g, b]
	//	(base body colors, not necessarily icon colors? hence the unused values?)
	const standardColor = {
		"GreenLizard":  [0.2,      1,       0       ],
		"PinkLizard":   [1,        0,       1       ],
		"BlueLizard":   [0,        0.5,     1       ],
		"YellowLizard": [1,        0.6,     0       ],
		"WhiteLizard":  [1,        1,       1       ],
		"RedLizard":    [1,        0,       0       ],	//	unused
		"BlackLizard":  [0.1,      0.1,     0.1     ],	//	unused
		"Salamander":   [1,        1,       1       ],	//	unused
		"CyanLizard":   [0,        1,       0.9     ],	//	unused
		"SpitLizard":   [0.55,     0.4,     0.2     ],
		"ZoopLizard":   [0.95,     0.73,    0.73    ],	//	unused
		"TrainLizard":  [0.254902, 0,       0.215686]	//	unused
	};
	/*
	 *	Game extract: CreatureSymbol::ColorOfCreature
	 *	Paste in verbatim, then make these changes:
	 *	- Adjust tabbing level to current scope
	 *	- Search and replace:
	 *		/iconData\.critType\s==\sCreatureTemplate\.Type\.|iconData\.critType\s==\sMoreSlugcatsEnums\.CreatureTemplateType\./ --> "type == \""
	 *		/\)\r\n\t{1,2}\{\r\n\t{2,3}/ --> "\"\)\r\n\t\t"
	 *		/\t{1,2}\}\r\n\t{1,2}if/ --> "\tif"
	 *		/\s\|\|\s/ --> "\" || "
	 *		/return\snew\sColor\(/ --> "c = ["
	 *		/\);\r\n\t{1,2}\}/ --> "];"
	 *		/return\s\(StaticWorld\.GetCreatureTemplate\(iconData\.critType\)\.breedParameters\sas\sLizardBreedParams\)\.standardColor;\r\n\t\}/ --> "c = standardColor\[type\];"
	 *	- remove f's on colors (e.g. /f\,\s/ --> ", " then /f]/ --> ", " then 
	 *	- Remove MSC sub-clause
	 *	- Manually find and replace targets for slugcat ArenaColor, HunterDaddy and MenuColors.MediumGrey
	 *	- Yes, using regex on code is messy, inspect the results!  Don't be a dummy!
	 *	- Assumes CreatureTemplate enums use symbols equal to string contents; this appears to
	 *		always be the case, but may vary with future updates, or modded content.  Beware!
	 */
	var c = HSL2RGB(0.73055553, 0.08, 0.67);	//	Menu.Menu::MenuColor (default value hoisted from end)
	if (type == "Slugcat")
		c = [1, 1, 1];	//	PlayerGraphics::DefaultSlugcatColor (White)
	if (type == "GreenLizard")
		c = standardColor[type];
	if (type == "PinkLizard")
		c = standardColor[type];
	if (type == "BlueLizard")
		c = standardColor[type];
	if (type == "WhiteLizard")
		c = standardColor[type];
	if (type == "RedLizard")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "BlackLizard")
		c = [0.36862746, 0.36862746, 0.43529412];
	if (type == "YellowLizard" || type == "SmallCentipede" || type == "Centipede")
		c = [1, 0.6, 0];
	if (type == "RedCentipede")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "CyanLizard" || type == "Overseer")
		c = [0, 0.9098039, 0.9019608];
	if (type == "Salamander")
		c = [0.93333334, 0.78039217, 0.89411765];
	if (type == "CicadaB")
		c = [0.36862746, 0.36862746, 0.43529412];
	if (type == "CicadaA")
		c = [1, 1, 1];
	if (type == "SpitterSpider" || type == "Leech")
		c = [0.68235296, 0.15686275, 0.11764706];
	if (type == "SeaLeech" || type == "TubeWorm")
		c = [0.05, 0.3, 0.7];
	if (type == "Centiwing")
		c = [0.05490196, 0.69803923, 0.23529412];
	if (type == "BrotherLongLegs")
		c = [0.45490196, 0.5254902, 0.30588236];
	if (type == "DaddyLongLegs")
		c = [0, 0, 1];
	if (type == "VultureGrub")
		c = [0.83137256, 0.7921569, 0.43529412];
	if (type == "EggBug")
		c = [0, 1, 0.47058824];
	if (type == "BigNeedleWorm" || type == "SmallNeedleWorm")
		c = [1, 0.59607846, 0.59607846];
	if (type == "Hazer")
		c = [0.21176471, 0.7921569, 0.3882353];
	if (type == "Vulture" || type == "KingVulture")
		c = [0.83137256, 0.7921569, 0.43529412];
	if (type == "ZoopLizard")
		c = [0.95, 0.73, 0.73];
	if (type == "StowawayBug")
		c = [0.36862746, 0.36862746, 0.43529412];
	if (type == "AquaCenti")
		c = [0, 0, 1];
	if (type == "TerrorLongLegs" || type == "TrainLizard")
		c = [0.3, 0, 1];
	if (type == "MotherSpider" || type == "JungleLeech")
		c = [0.1, 0.7, 0.1];
	if (type == "HunterDaddy")
		//	var a = {r: 1, g: 0.4509804, b: 0.4509804};	//	PlayerGraphics::DefaultSlugcatColor (Red)
		//	var b = {r: 0.5, g: 0.5, b: 0.5}, t = 0.4;	//	UnityEngine.Color::gray
		//	//	Lerp 0.4:
		//	var c = {r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t};	//	UnityEngine.Color::Lerp(a, b)
		//	-> c = {r: 0.8, g: 0.47058824, b: 0.47058824}
		c = [0.8, 0.47058824, 0.47058824];
	if (type == "MirosVulture")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "FireBug")
		c = [1, 0.47058824, 0.47058824];
	if (type == "SpitLizard")
		c = standardColor[type];
	if (type == "EelLizard")
		c = [0.02, 0.78039217, 0.2];
	if (type == "Inspector")
		c = [0.44705883, 0.9019608, 0.76862746];
	if (type == "Yeek")
		c = [0.9, 0.9, 0.9];
	if (type == "BigJelly")
		c = [1, 0.85, 0.7];
	/* end copy */

	return colorFloatToString(c);
}

/**
 *	Helper functions to generate below tables.
 *	Converts item value string to HTML color; ported from game/mod.
 *	TODOs: same as creatureNameToIconAtlas().
 */
function itemNameToIconColor(type) {
	/*
	 *	Game extract: ItemSymbol::ColorForItem
	 *	Paste in verbatim, then make these changes:
	 *	- Adjust tabbing level to current scope
	 *	- Search and replace:
	 *		/itemType == AbstractPhysicalObject\.AbstractObjectType\./ --> "type == \""
	 *		/ModManager.MSC && itemType == MoreSlugcatsEnums.AbstractObjectType./ --> "type == \""
	 *		/\)\r\n\t{1,2}\{\r\n\t{2,3}/ --> "\"\)\r\n\t\t"
	 *		/\t{1,2}\}\r\n\t{1,2}if/ --> "\tif"
	 *		/ \|\| / --> "\" || "
	 *		/return new Color\(/ --> "c = ["
	 *		/\);\r\n\t+\}/ --> "];"
	 *		/return\s\(StaticWorld\.GetCreatureTemplate\(iconData\.critType\)\.breedParameters\sas\sLizardBreedParams\)\.standardColor;\r\n\t\}/ --> "c = standardColor\[type\];"
	 *	- ummm doing this one after creatureNameToIconColor, kinda don't care about exact refactoring notes
	 *	- For items with intData, append the value to type; these are enumerated individually
	 *	- except for PebblesPearl3 (includes any intData >= 3), PebblesPearl (intData < 0)
	 */
	var c = HSL2RGB(0.73055553, 0.08, 0.67);	//	Menu::MenuColors.MediumGrey
	if (type == "SporePlant")
		c = [0.68235296, 0.15686275, 0.11764706];
	if (type == "FirecrackerPlant")
		c = [0.68235296, 0.15686275, 0.11764706];
	if (type == "ScavengerBomb")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "Spear1")
		c = [0.9019608, 0.05490196, 0.05490196];
	if (type == "Spear2")
		c = [0, 0, 1];
	if (type == "Spear3")
		c = [1, 0.47058824, 0.47058824];
	if (type == "Lantern")
		c = [1, 0.57254905, 0.31764707];
	if (type == "FlareBomb")
		c = [0.73333335, 0.68235296, 1];
	if (type == "SlimeMold")
		c = [1, 0.6, 0];
	if (type == "BubbleGrass")
		c = [0.05490196, 0.69803923, 0.23529412];
	if (type == "DangleFruit")
		c = [0, 0, 1];
	if (type == "Mushroom")
		c = [1, 1, 1];
	if (type == "WaterNut")
		c = [0.05, 0.3, 0.7];
	if (type == "EggBugEgg")
		c = [0, 1, 0.47058824];
	if (type == "FlyLure")
		c = [0.6784314, 0.26666668, 0.21176471];
	if (type == "SSOracleSwarmer")
		c = [1, 1, 1];
	if (type == "NSHSwarmer")
		c = [0, 1, 0.3];
	if (type == "NeedleEgg")
		c = [0.5764706, 0.16078432, 0.2509804];
	if (type == "PebblesPearl1")
		c = [0.7, 0.7, 0.7];
	if (type == "PebblesPearl2")
		c = HSL2RGB(0.73055553, 0.08, 0.3);
	if (type == "PebblesPearl3")	//	intData >= 3
		c = [1, 0.47843137, 0.007843138];
	if (type == "PebblesPearl") 	//	intData < 0
		c = [0, 0.45490196, 0.6392157];
	if (type == "DataPearl" || itemType == "HalcyonPearl") {
		if (intData > 1 && intData < DataPearlList.length) {
				var mc = UniquePearlMainColor(intData);
				var hc = UniquePearlHighLightColor(intData);
				if (hc != null)
					mc = ColorScreen(mc, ColorQuickSaturation(hc, 0.5));
				else
					mc = ColorLerp(mc, [1, 1, 1], 0.15);
				if (mc[0] < 0.1 && mc[1] < 0.1 && mc[2] < 0.1)
					mc = ColorLerp(mc, HSL2RGB(0.73055553, 0.08, 0.67), 0.3);
				c = mc;
		} else if (intData == 1)
			c = [1, 0.6, 0.9];
		else
			c = [0.7, 0.7, 0.7];
	} else {
		if (type == "Spearmasterpearl")
			c = ColorLerp([0.45, 0.01, 0.04], [1, 1, 1], 0.15);
		if (type == "EnergyCell")
			c = [0.01961, 0.6451, 0.85];
		if (type == "SingularityBomb")
			c = [0.01961, 0.6451, 0.85];
		if (type == "GooieDuck")
			c = [0.44705883, 0.9019608, 0.76862746];
		if (type == "LillyPuck")
			c = [0.17058827, 0.9619608, 0.9986275];
		if (type == "GlowWeed")
			c = [0.94705886, 1, 0.26862746];
		if (type == "DandelionPeach")
			c = [0.59, 0.78, 0.96];
		if (type == "MoonCloak")
			c = [0.95, 1, 0.96];
		if (type == "FireEgg")
			c = [1, 0.47058824, 0.47058824];
	}
	return c;
}

/**
 *	Helper functions:
 *	Port of various functions to enumerate and calculate pearl colors.
 */
function makePearlColors() {
	for (var intData = 2; intData < DataPearlList.length; intData++) {
		var name = DataPearlList[intData];
		var mc = UniquePearlMainColor(intData);
		var hc = UniquePearlHighLightColor(intData);
		if (hc !== undefined)
			mc = ColorScreen(mc, ColorQuickSaturation(hc, 0.5));
		else
			mc = ColorLerp(mc, [1, 1, 1], 0.15);
		if (mc[0] < 0.1 && mc[1] < 0.1 && mc[2] < 0.1)
			mc = ColorLerp(mc, HSL2RGB(0.73055553, 0.08, 0.67), 0.3);
		var s = "\t\"" + name + "\": [";
		s += ((Math.round(mc[0] * 1e6) / 1e6).toString() + "       ").substring(0, 8);
		for (var i = 1; i < mc.length; i++)
			s += ", " + ((Math.round(mc[i] * 1e6) / 1e6).toString() + "       ").substring(0, 8);
		s += "],";
		console.log(s);
	}

	/**
	 *	From base game, DataPearl
	 *	s/DataPearl\.AbstractDataPearl\.DataPearlType\.|MoreSlugcatsEnums\.DataPearlType\./\"/
	 *	s/ \|\| /\" || /
	 *	s/\)\r\n\t+\{/\"\) \{/
	 *	etc.
	 */
	function UniquePearlMainColor(intData) {
		var pearlType = DataPearlList[intData];
		var c = [0.7, 0.7, 0.7];
		if (pearlType == "SI_west")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_top")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_chat3")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_chat4")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_chat5")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "Spearmasterpearl")
			c = [0.04, 0.01, 0.04];
		if (pearlType == "SU_filt")
			c = [1, 0.75, 0.9];
		if (pearlType == "DM")
			c = [0.95686275, 0.92156863, 0.20784314];
		if (pearlType == "LC")
			c = HSL2RGB(0.34, 1, 0.2);
		if (pearlType == "LC_second")
			c = [0.6, 0, 0];
		if (pearlType == "OE")
			c = [0.54901963, 0.36862746, 0.8];
		if (pearlType == "MS")
			c = [0.8156863, 0.89411765, 0.27058825];
		if (pearlType == "RM")
			c = [0.38431373, 0.18431373, 0.9843137];
		if (pearlType == "Rivulet_stomach")
			c = [0.5882353, 0.87058824, 0.627451];
		if (pearlType == "CL")
			c = [0.48431373, 0.28431374, 1];
		if (pearlType == "VS")
			c = [0.53, 0.05, 0.92];
		if (pearlType == "BroadcastMisc")
			c = [0.9, 0.7, 0.8];
		if (pearlType == "CC")
			c = [0.9, 0.6, 0.1];
		if (pearlType == "DS")
			c = [0, 0.7, 0.1];
		if (pearlType == "GW")
			c = [0, 0.7, 0.5];
		if (pearlType == "HI")
			c = [0.007843138, 0.19607843, 1];
		if (pearlType == "LF_bottom")
			c = [1, 0.1, 0.1];
		if (pearlType == "LF_west")
			c = [1, 0, 0.3];
		if (pearlType == "SB_filtration")
			c = [0.1, 0.5, 0.5];
		if (pearlType == "SH")
			c = [0.2, 0, 0.1];
		if (pearlType == "SI_top")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SI_west")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SL_bridge")
			c = [0.4, 0.1, 0.9];
		if (pearlType == "SL_moon")
			c = [0.9, 0.95, 0.2];
		if (pearlType == "SB_ravine")
			c = [0.01, 0.01, 0.01];
		if (pearlType == "SU")
			c = [0.5, 0.6, 0.9];
		if (pearlType == "UW")
			c = [0.4, 0.6, 0.4];
		if (pearlType == "SL_chimney")
			c = [1, 0, 0.55];
		if (pearlType == "Red_stomach")
			c = [0.6, 1, 0.9];
		return c;
	}

	function UniquePearlHighLightColor(intData) {
		var pearlType = DataPearlList[intData];
		var c;
		if (pearlType == "SI_chat3")
			c = [0.4, 0.1, 0.6];
		if (pearlType == "SI_chat4")
			c = [0.4, 0.6, 0.1];
		if (pearlType == "SI_chat5")
			c = [0.6, 0.1, 0.4];
		if (pearlType == "Spearmasterpearl")
			c = [0.95, 0, 0];
		if (pearlType == "RM")
			c = [1, 0, 0];
		if (pearlType == "LC_second")
			c = [0.8, 0.8, 0];
		if (pearlType == "CL")
			c = [1, 0, 0];
		if (pearlType == "VS")
			c = [1, 0, 1];
		if (pearlType == "BroadcastMisc")
			c = [0.4, 0.9, 0.4];
		if (pearlType == "CC")
			c = [1, 1, 0];
		if (pearlType == "GW")
			c = [0.5, 1, 0.5];
		if (pearlType == "HI")
			c = [0.5, 0.8, 1];
		if (pearlType == "SH")
			c = [1, 0.2, 0.6];
		if (pearlType == "SI_top")
			c = [0.1, 0.4, 0.6];
		if (pearlType == "SI_west")
			c = [0.1, 0.6, 0.4];
		if (pearlType == "SL_bridge")
			c = [1, 0.4, 1];
		if (pearlType == "SB_ravine")
			c = [0.6, 0.1, 0.4];
		if (pearlType == "UW")
			c = [1, 0.7, 1];
		if (pearlType == "SL_chimney")
			c = [0.8, 0.3, 1];
		if (pearlType == "Red_stomach")
			c = [1, 1, 1];
		return c;
	}

	function ColorScreen(a, b) {
		return [1 - (1 - a[0]) * (1 - b[0]), 1 - (1 - a[1]) * (1 - b[1]), 1 - (1 - a[2]) * (1 - b[2])];
	}

	function ColorLerp(a, b, t) {
		return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
	}
	function ColorQuickSaturation(hc, value) {
		var a = QuickSaturation(hc) * value;
		return [hc[0] * a, hc[1] * a, hc[2] * a];
	}

	function QuickSaturation(col) {
		return InverseLerp(Math.max(...col), 0, Math.min(...col));
	}

	function InverseLerp(a, b, value) {
		var result;
		if (a != b)
			result = Math.min(Math.max((value - a) / (b - a), 0), 1);
		else
			result = 0;
		return result;
	}
}

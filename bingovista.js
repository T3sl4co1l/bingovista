/* * * Constants and Defaults * * */

/* HTML IDs */
const ids = {
	clear: "clear",
	textbox: "textbox",
	parse: "parse",
	load: "fileload",
	drop: "droptarget",
	board: "board",
	square: "square",
	desc: "desctxt",
	message: "errorbox",
	darkstyle: "darkmode",
	radio1: "dark",
	radio2: "light"
};

/**
 *	List of sprite atlases, in order of precedence, highest to lowest.
 *	drawIcon() searches this list, in order, for an icon it needs; when one is found,
 *	it caches a local copy in drawIconMemoize.
 *	These are pre-loaded on startup from the named references, but unnamed or external
 *	references can be added by pushing (least priority), shifting (most), or inserting
 *	(anywhere) additional data.
 *	The named targets are not themselves referenced directly elsewhere.
 */
const atlases = [
	{ img: "bingoicons.png",   txt: "bingoicons.txt",   canv: undefined, frames: undefined },	/**< from Bingo mod */
	{ img: "uispritesmsc.png", txt: "uispritesmsc.txt", canv: undefined, frames: undefined }, 	/**< from DLC */
	{ img: "uiSprites.png",    txt: "uiSprites.txt",    canv: undefined, frames: undefined } 	/**< from base game */
];

/* Bingo square graphics constants (dimensions in px) */
const SQUARE_WIDTH = 85;
const SQUARE_HEIGHT = 85;
const SQUARE_MARGIN = 4;
const SQUARE_BORDER = 2;
const SQUARE_COLOR = "#ffffff";
const SQUARE_BACKGROUND = "#020204";
const SQUARE_FONT = "bolder 16px \"Arial Narrow\", sans-serif";

var board;

/** Flag to reveal full detail on otherwise-hidden challenges e.g. Vista Points */
var kibitzing = false;

/* * * Functions * * */

/* * * Event Handlers and Initialization * * */

document.addEventListener("DOMContentLoaded", function() {

	//	File load stuff
	document.getElementById(ids.clear).addEventListener("click", function(e) {
		document.getElementById(ids.textbox).value = "";
	});
	document.getElementById(ids.parse).addEventListener("click", parseText);
	document.getElementById(ids.board).addEventListener("click", selectSquare);
	document.getElementById(ids.load).addEventListener("change", function() { doLoadFile(this.files) } );
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

	document.getElementById(ids.radio1).addEventListener("change", toggleDark);
	document.getElementById(ids.radio2).addEventListener("change", toggleDark);

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
	Promise.all(loaders).then(function() {
		//console.log("Resources loaded!");
		var u = new URL(document.URL).searchParams;
		if (u.has("b")) {
			var board = u.get("b");
			//	parse encoded version
			var s = boardEncodeToText(board);
			//	populate text box with mod compatible format
			document.getElementById(ids.textbox).value = s;
			parseText();
		}
	}).catch(function(e) {
		console.log("Promise.all(): failed to complete fetches. Error: " + e.message);
	});

	if (document.getElementById(ids.radio1).checked)
		document.getElementById(ids.darkstyle).media = "screen";
	else
		document.getElementById(ids.darkstyle).media = "none";

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
	while (mb.firstChild)
		mb.removeChild(mb.firstChild);
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
	
	var goals = s.split(/bChG/);
	var size = Math.ceil(Math.sqrt(goals.length));
	board = { size: size, width: size, height: size, goals: [] };
	for (var i = 0; i < goals.length; i++) {
		var type, desc;
		if (goals[i].search("~") > 0 && goals[i].search("><") > 0) {
			[type, desc] = goals[i].split("~");
			desc = desc.split(/></);
			if (CHALLENGES[type] !== undefined) {
				try {
					board.goals.push(CHALLENGES[type](desc));
				} catch (e) {
					board.goals.push(defaultGoal(type, desc));
					board.goals[board.goals.length - 1].description = e.message;
				}
			} else {
				board.goals.push(defaultGoal(type, desc));
			}
		} else {
			board.goals.push(defaultGoal("null", goals[i]));
		}
	}

	function defaultGoal(t, d) {
		return {
			name: t,
			category: "null",
			item: "",
			description: "There was an error generating this goal; desc: '" + d + "'",
			value: "",
			paint: [
				{ type: "verse", value: "∅", scale: 1, color: "#ffffff", rotation: 0 }
			]
		};
	}

	var ctx = document.getElementById(ids.board).getContext("2d");
	ctx.fillStyle = SQUARE_BACKGROUND;
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	for (var i = 0; i < board.goals.length; i++) {
		drawSquare(ctx, board.goals[i],
				Math.floor(i / board.height) * (SQUARE_WIDTH + SQUARE_MARGIN + SQUARE_BORDER) + (SQUARE_BORDER + SQUARE_MARGIN) / 2,
				(i % board.height) * (SQUARE_HEIGHT + SQUARE_MARGIN + SQUARE_BORDER) + (SQUARE_BORDER + SQUARE_MARGIN) / 2);
	}

	console.log(board);
}

/**
 *	Clicked on canvas.
 */
function selectSquare(e) {
	var el = document.getElementById(ids.desc);
	var ctx = document.getElementById(ids.square).getContext("2d");
	if (board === undefined) {
		clearDescription();
		return;
	}
	var x = e.offsetX - (SQUARE_BORDER + SQUARE_MARGIN) / 2;
	var y = e.offsetY - (SQUARE_BORDER + SQUARE_MARGIN) / 2;
	var sqWidth = SQUARE_WIDTH + SQUARE_MARGIN + SQUARE_BORDER;
	var sqHeight = SQUARE_WIDTH + SQUARE_MARGIN + SQUARE_BORDER;
	var col = Math.floor(x / sqWidth);
	var row = Math.floor(y / sqHeight);
	if (x >=0 && y >= 0 && (x % sqWidth) < (sqWidth - SQUARE_MARGIN)
			&& (y % sqHeight) < (sqHeight - SQUARE_MARGIN)
			&& row < board.height && col < board.width) {
		ctx.fillStyle = SQUARE_BACKGROUND;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		var goal = board.goals[row + col * board.height];
		drawSquare(ctx, goal, (SQUARE_BORDER + SQUARE_MARGIN) / 2, (SQUARE_BORDER + SQUARE_MARGIN) / 2);
		while (el.firstChild)
			el.removeChild(el.firstChild);
		el.innerHTML = "Challenge: " + goal.category + "<br>"
				+ goal.item + ": " + goal.value + "<br>"
				+ goal.description;
		return;
	}
	clearDescription();

	function clearDescription() {
		ctx.fillStyle = SQUARE_BACKGROUND;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		while (el.firstChild)
			el.removeChild(el.firstChild);
		el.appendChild(document.createTextNode("Select a square to view details."));
	}
}

/**
 *	Draw a challenge square to the specified canvas at the specified location (top-left corner).
 */
function drawSquare(ctx, goal, x, y) {
	ctx.beginPath();
	ctx.strokeStyle = SQUARE_COLOR;
	ctx.lineWidth = SQUARE_BORDER;
	ctx.lineCap = "butt";
	ctx.moveTo(x, y);
	ctx.lineTo(x + SQUARE_WIDTH, y);
	ctx.moveTo(x + SQUARE_WIDTH, y);
	ctx.lineTo(x + SQUARE_WIDTH, y + SQUARE_HEIGHT);
	ctx.moveTo(x + SQUARE_WIDTH, y + SQUARE_HEIGHT);
	ctx.lineTo(x, y + SQUARE_HEIGHT);
	ctx.moveTo(x, y + SQUARE_HEIGHT);
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
	ctx.font = SQUARE_FONT;
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	var xBase, yBase;
	for (var i = 0; i < lines.length; i++) {
		yBase = y + SQUARE_BORDER / 2 + (SQUARE_HEIGHT - SQUARE_BORDER) * (i + 1) / (lines.length + 1);
		yBase = Math.round(yBase);
		for (var j = 0; j < lines[i].length; j++) {
			xBase = x + SQUARE_BORDER / 2 + (SQUARE_WIDTH - SQUARE_BORDER) * (j + 1) / (lines[i].length + 1);
			xBase = Math.round(xBase);
			if (lines[i][j].type == "icon") {
				drawIcon(ctx, lines[i][j].value, xBase, yBase, lines[i][j].color, lines[i][j].scale, lines[i][j].rotation); 
			} else if (lines[i][j].type == "text") {
				ctx.fillStyle = lines[i][j].color;
				ctx.fillText(lines[i][j].value, xBase, yBase);
			} else {
				//	unimplemented
				drawIcon(ctx, "Futile_White", xBase, yBase, "#ffffff", lines[i][j].scale || 1, lines[i][j].rotation || 0); 
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
	//	Search atlases for sprite
	var spri, src;
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
	ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 *	Challenge classes from Bingomod decomp.
 */
const CHALLENGES = {
	BingoAchievementChallenge: function(desc) {
		const thisname = "BingoAchievementChallenge";
		/** Game extract: WinState::PassageDisplayName */
		const DisplayName = {
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
		//	assert: desc similar to "System.String|Traveller|Passage|0|passage", "0", "0"
		var items = desc[0].split("|");
		checkDescriptors(thisname, items.length, 5, "descriptor item count");
		checkDescriptors(thisname, items[0], "System.String", "assert failed, type");
		checkDescriptors(thisname, items[2], "Passage", "item list name");
		if (DisplayName[items[1]] === undefined)
			throw new TypeError(thisname + ": goal name '" + items[1] + "' not found in item list");
		if (items[2] != "Passage")
			throw new TypeError(thisname + ": item list name '" + items[2] + "' is not 'Passage'");
		return {
			name: thisname,
			category: "Obtaining passages",
			item: "Passage",
			value: items[1],
			description: "Earn " + DisplayName[items[1]] + " passage",
			paint: [
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: items[1] + "A", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: "smallEmptyCircle", scale: 1, color: "#ffffff", rotation: 0 }
			]
		};
	},
	BingoAllRegionsExcept: function(desc) {
		const thisname = "BingoAllRegionsExcept";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoBombTollChallenge: function(desc) {
		const thisname = "BingoBombTollChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoCollectPearlChallenge: function(desc) {
		const thisname = "BingoCollectPearlChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoCraftChallenge: function(desc) {
		const thisname = "BingoCraftChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoCreatureGateChallenge: function(desc) {
		const thisname = "BingoCreatureGateChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoCycleScoreChallenge: function(desc) {
		const thisname = "BingoCycleScoreChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoDamageChallenge: function(desc) {
		const thisname = "BingoDamageChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoDepthsChallenge: function(desc) {
		const thisname = "BingoDepthsChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoDodgeLeviathanChallenge: function(desc) {
		const thisname = "BingoDodgeLeviathanChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoDontUseItemChallenge: function(desc) {
		const thisname = "BingoDontUseItemChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoEatChallenge: function(desc) {
		const thisname = "BingoEatChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoEchoChallenge: function(desc) {
		const thisname = "BingoEchoChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoEnterRegionChallenge: function(desc) {
		const thisname = "BingoEnterRegionChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoGlobalScoreChallenge: function(desc) {
		const thisname = "BingoGlobalScoreChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoGreenNeuronChallenge: function(desc) {
		const thisname = "BingoGreenNeuronChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoHatchNoodleChallenge: function(desc) {
		const thisname = "BingoHatchNoodleChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoHellChallenge: function(desc) {
		const thisname = "BingoHellChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoItemHoardChallenge: function(desc) {
		const thisname = "BingoItemHoardChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoKarmaFlowerChallenge: function(desc) {
		const thisname = "BingoKarmaFlowerChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoKillChallenge: function(desc) {
		const thisname = "BingoKillChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoMaulTypesChallenge: function(desc) {
		const thisname = "BingoMaulTypesChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoMaulXChallenge: function(desc) {
		const thisname = "BingoMaulXChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoNeuronDeliveryChallenge: function(desc) {
		const thisname = "BingoNeuronDeliveryChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoNoNeedleTradingChallenge: function(desc) {
		const thisname = "BingoNoNeedleTradingChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoNoRegionChallenge: function(desc) {
		const thisname = "BingoNoRegionChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoPearlDeliveryChallenge: function(desc) {
		const thisname = "BingoPearlDeliveryChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoPearlHoardChallenge: function(desc) {
		const thisname = "BingoPearlHoardChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoPinChallenge: function(desc) {
		const thisname = "BingoPinChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoPopcornChallenge: function(desc) {
		const thisname = "BingoPopcornChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoRivCellChallenge: function(desc) {
		const thisname = "BingoRivCellChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoSaintDeliveryChallenge: function(desc) {
		const thisname = "BingoSaintDeliveryChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoSaintPopcornChallenge: function(desc) {
		const thisname = "BingoSaintPopcornChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoStealChallenge: function(desc) {
		const thisname = "BingoStealChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoTameChallenge: function(desc) {
		const thisname = "BingoTameChallenge";
		//	assert: desc similar to "System.String|EelLizard|Creature Type|0|friend", "0", "0"
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = desc[0].split("|");
		checkDescriptors(thisname, items.length, 5, "descriptor item count");
		checkDescriptors(thisname, items[0], "System.String", "assert failed, type");
		checkDescriptors(thisname, items[2], "Creature Type", "item list name");
		var d = creatureNameToDisplayTextMap[items[1]];
		if (d === undefined)
			throw new TypeError("creatureNameToDisplayTextMap: type '" + String(items[1]) + "' not found in list");
		//	English cleanup (have fun translating this..?)
		if (d.lastIndexOf("s") > 0) d = d.slice(0, d.lastIndexOf("s"));
		var anVowel = "";
		if (["A", "a", "E", "e", "I", "i", "O", "o", "U", "u"].includes(d.substring(0, 1)))
			anVowel = "n";
		return {
			name: thisname,
			category: "Befriending a creature",
			item: "Creature Type",
			value: items[1],
			description: "Befriend a" + anVowel + " " + d,
			paint: [
				{ type: "icon", value: "FriendB", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: creatureNameToIconAtlasMap[items[1]], scale: 1,
						color: colorFloatToString(...creatureNameToIconColorMap[items[1]]), rotation: 0 }
			]
		};
	},
	BingoTradeChallenge: function(desc) {
		const thisname = "BingoTradeChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoTradeTradedChallenge: function(desc) {
		const thisname = "BingoTradeTradedChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoTransportChallenge: function(desc) {
		const thisname = "BingoTransportChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoUnlockChallenge: function(desc) {
		const thisname = "BingoUnlockChallenge";
		//
		return {
			name: thisname,
			category: "null",
			item: "",
			value: "",
			description: "Not yet implemented.",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoVistaChallenge: function(desc) {
		const thisname = "BingoVistaChallenge";
		//	desc is of format ["CC", "System.String|CC_A10|Room|0|vista", "734", "506", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		//	desc[0] is region code
		var v = (regionCodeToDisplayName[desc[0]] || "") + " / " + (regionCodeToDisplayNameSaint[desc[0]] || "");
		v = v.replace(/^\s\/\s|\s\/\s$/g, "");
		if (v == "") v = "Unknown Region";
//		var v = "";
//		if (regionCodeToDisplayName[desc[0]] === undefined
//				&& regionCodeToDisplayNameSaint[desc[0]] === undefined) {
//			v = "Unknown Region";
//		} else {
//			if (regionCodeToDisplayName[desc[0]] !== undefined
//					&& regionCodeToDisplayNameSaint[desc[0]] !== undefined)
//				v = regionCodeToDisplayName[desc[0]] + " / " + regionCodeToDisplayNameSaint[desc[0]];
//			else
//				v = regionCodeToDisplayName[desc[0]] || regionCodeToDisplayNameSaint[desc[0]];
//		}
		//	assert: desc[1] similar to "System.String|CC_A10|Room|0|vista"
		var items = desc[1].split("|");
		checkDescriptors(thisname, items.length, 5, "descriptor item count");
		checkDescriptors(thisname, items[0], "System.String", "assert failed, type");
		checkDescriptors(thisname, items[2], "Room", "item list name");
		return {
			name: thisname,
			category: "Visiting vistas",
			item: (kibitzing ? "Room" : "Region"),
			value: (kibitzing ? items[1] : v),
			description: "Reach the vista point in " + v + (kibitzing ? ("; in room: " + items[1] + " at x: " + desc[2] + ", y: " + desc[3]) : ""),
			paint: [
				{ type: "icon", value: "vistaicon", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "break" },
				{ type: "text", value: items[1].substring(0, items[1].search("_")), color: "#ffffff" }
			]
		};
	}
};

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
	if (typeof(d) === "string") s = "'" + s + "'";
	if (typeof(g) === "string") h = "'" + h + "'";
	if (d != g) throw new TypeError(t + ": error, " + err + " " + s + ", expected: " + h);
}

/* * * Utility Functions * * */

/**
 *	Convert floating point triple to HTML color string.
 */
function colorFloatToString(r, g, b) {
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
	"MS": "Submerged Superstructure",
	"SB": "Primordial Underground",
	"SI": "Windswept Spires",
	"SL": "Frigid Coast",
	"SU": "Suburban Drifts",
	"UG": "Undergrowth",
	"VS": "Barren Conduits"
};

/**
 *	Convert creature value string to display text.
 *	Game extract: ChallengeTools::CreatureName
 */
const creatureNameToDisplayTextMap = {
	"Slugcat":        	"Slugcats",
	"GreenLizard":    	"Green Lizards",
	"PinkLizard":     	"Pink Lizards",
	"BlueLizard":     	"Blue Lizards",
	"WhiteLizard":    	"White Lizards",
	"BlackLizard":    	"Black Lizards",
	"YellowLizard":   	"Yellow Lizards",
	"CyanLizard":     	"Cyan Lizards",
	"RedLizard":      	"Red Lizards",
	"Salamander":     	"Salamander",
	"CicadaA":        	"White Cicadas",
	"CicadaB":        	"Black Cicadas",
	"Snail":          	"Snails",
	"PoleMimic":      	"Pole Mimics",
	"TentaclePlant":  	"Monster Kelp",
	"Scavenger":      	"Scavengers",
	"Vulture":        	"Vultures",
	"KingVulture":    	"King Vultures",
	"SmallCentipede": 	"Small Centipedes",
	"Centipede":      	"Large Centipedes",
	"RedCentipede":   	"Red Centipedes",
	"Centiwing":      	"Centiwings",
	"LanternMouse":   	"Lantern Mice",
	"BigSpider":      	"Large Spiders",
	"SpitterSpider":  	"Spitter Spiders",
	"MirosBird":      	"Miros Birds",
	"BrotherLongLegs":	"Brother Long Legs",
	"DaddyLongLegs":  	"Daddy Long Legs",
	"TubeWorm":       	"Tube Worms",
	"EggBug":         	"Egg Bugs",
	"DropBug":        	"Dropwigs",
	"BigNeedleWorm":  	"Large Noodleflies",
	"JetFish":        	"Jetfish",
	"BigEel":         	"Leviathans",
	"Deer":           	"Rain Deer",
	"Fly":            	"Batflies",
	"MirosVulture":   	"Miros Vultures",
	"MotherSpider":   	"Mother Spiders",
	"EelLizard":      	"Eel Lizards",
	"SpitLizard":     	"Caramel Lizards",
	"TerrorLongLegs": 	"Terror Long Legs",
	"AquaCenti":      	"Aquapedes",
	"FireBug":        	"Firebugs",
	"Inspector":      	"Inspectors",
	"Yeek":           	"Yeek",
	"BigJelly":       	"Large Jellyfish",
	"StowawayBug":    	"Stowaway Bugs",
	"ZoopLizard":     	"Strawberry Lizards",
	"ScavengerElite": 	"Elite Scavengers",
	"SlugNPC":        	"Slugcats"
};

/**
 *	Convert creature value string to atlas name string.
 *	TODO?: Throws if key not found (currently returns "Futile_White" game default)
 *	TODO?: refactor to associative array (convert ifs, ||s into more properties?
 *	    minor manual edit overhead)
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
	if (type == "FireBug")
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
	"RedCentipede":   	"Kill_Centipede3",
	"BrotherLongLegs":	"Kill_Daddy",
	"DaddyLongLegs":  	"Kill_Daddy",
	"LanternMouse":   	"Kill_Mouse",
	"GarbageWorm":    	"Kill_Garbageworm",
	"Fly":            	"Kill_Bat",
	"Leech":          	"Kill_Leech",
	"SeaLeech":       	"Kill_Leech",
	"Spider":         	"Kill_SmallSpider",
	"JetFish":        	"Kill_Jetfish",
	"BigEel":         	"Kill_BigEel",
	"Deer":           	"Kill_RainDeer",
	"TubeWorm":       	"Kill_Tubeworm",
	"TentaclePlant":  	"Kill_TentaclePlant",
	"PoleMimic":      	"Kill_PoleMimic",
	"MirosBird":      	"Kill_MirosBird",
	"Overseer":       	"Kill_Overseer",
	"VultureGrub":    	"Kill_VultureGrub",
	"EggBug":         	"Kill_EggBug",
	"BigSpider":      	"Kill_BigSpider",
	"SpitterSpider":  	"Kill_BigSpider",
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
	"FireBug":        	"Kill_EggBug",
	"ScavengerElite": 	"Kill_ScavengerElite",
	"ScavengerKing":  	"Kill_ScavengerKing",
	"SpitLizard":     	"Kill_Spit_Lizard",
	"Inspector":      	"Kill_Inspector",
	"Yeek":           	"Kill_Yeek",
	"BigJelly":       	"Kill_BigJellyFish",
	"SlugNPC":        	"Kill_Slugcat",
	"Default":        	"Futile_White"
}

/**
 *	Convert creature value string to HTML color.
 *	TODOs: same as creatureNameToIconAtlas().
 */
function creatureNameToIconColor(type) {
	var c;
	//	values excerpted from LizardBreeds::BreedTemplate; returns array [r, g, b]
	//	(base body colors, not necessarily icon colors? hence the unused values?)
	const standardColor = {
		"GreenLizard":  [0.2,  1,    0   ],
		"PinkLizard":   [1,    0,    1   ],
		"BlueLizard":   [0,    0.5,  1   ],
		"YellowLizard": [1,    0.6,  0   ],
		"WhiteLizard":  [1,    1,    1   ],
		"RedLizard":    [1,    0,    0   ],	//	unused
		"BlackLizard":  [0.1,  0.1,  0.1 ],	//	unused
		"Salamander":   [1,    1,    1   ],	//	unused
		"CyanLizard":   [0,    1,    0.9 ],	//	unused
		"SpitLizard":   [0.55, 0.4,  0.2 ],
		"ZoopLizard":   [0.95, 0.73, 0.73],	//	unused
		"TrainLizard":  [0.25490195, 0, 0.21568628]	//	unused
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
	c = HSL2RGB(0.73055553, 0.08, 0.67);	//	Menu.Menu::MenuColor (default value hoisted from end)
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

	return colorFloatToString(...c);
}

/**
 *	Refactoring of creatureNameToIconColor() to associative array.
 */
const creatureNameToIconColorMap = {
	"Slugcat":        	[1, 1, 1],
	"GreenLizard":    	[0.2, 1, 0],
	"PinkLizard":     	[1, 0, 1],
	"BlueLizard":     	[0, 0.5, 1],
	"WhiteLizard":    	[1, 1, 1],
	"RedLizard":      	[0.9019608, 0.05490196, 0.05490196],
	"BlackLizard":    	[0.36862746, 0.36862746, 0.43529412],
	"YellowLizard":	  	[1, 0.6, 0],
	"SmallCentipede": 	[1, 0.6, 0],
	"Centipede":      	[1, 0.6, 0],
	"RedCentipede":   	[0.9019608, 0.05490196, 0.05490196],
	"CyanLizard":     	[0, 0.9098039, 0.9019608],
	"Overseer":       	[0, 0.9098039, 0.9019608],
	"Salamander":     	[0.93333334, 0.78039217, 0.89411765],
	"CicadaB":        	[0.36862746, 0.36862746, 0.43529412],
	"CicadaA":        	[1, 1, 1],
	"SpitterSpider":  	[0.68235296, 0.15686275, 0.11764706],
	"Leech":          	[0.68235296, 0.15686275, 0.11764706],
	"SeaLeech":       	[0.05, 0.3, 0.7],
	"TubeWorm":       	[0.05, 0.3, 0.7],
	"Centiwing":      	[0.05490196, 0.69803923, 0.23529412],
	"BrotherLongLegs":	[0.45490196, 0.5254902, 0.30588236],
	"DaddyLongLegs":  	[0, 0, 1],
	"VultureGrub":    	[0.83137256, 0.7921569, 0.43529412],
	"EggBug":         	[0, 1, 0.47058824],
	"BigNeedleWorm":  	[1, 0.59607846, 0.59607846],
	"SmallNeedleWorm":	[1, 0.59607846, 0.59607846],
	"Hazer":          	[0.21176471, 0.7921569, 0.3882353],
	"Vulture":        	[0.83137256, 0.7921569, 0.43529412],
	"KingVulture":    	[0.83137256, 0.7921569, 0.43529412],
	"ZoopLizard":     	[0.95, 0.73, 0.73],
	"StowawayBug":    	[0.36862746, 0.36862746, 0.43529412],
	"AquaCenti":      	[0, 0, 1],
	"TerrorLongLegs": 	[0.3, 0, 1],
	"TrainLizard":    	[0.3, 0, 1],
	"MotherSpider":   	[0.1, 0.7, 0.1],
	"JungleLeech":    	[0.1, 0.7, 0.1],
	"HunterDaddy":    	[0.8, 0.47058824, 0.47058824],
	"MirosVulture":   	[0.9019608, 0.05490196, 0.05490196],
	"FireBug":        	[1, 0.47058824, 0.47058824],
	"SpitLizard":     	[0.55, 0.4, 0.2],
	"EelLizard":      	[0.02, 0.78039217, 0.2],
	"Inspector":      	[0.44705883, 0.9019608, 0.76862746],
	"Yeek":           	[0.9, 0.9, 0.9],
	"BigJelly":       	[1, 0.85, 0.7],
	"Default":        	[0.66383999, 0.6436, 0.6964]
};

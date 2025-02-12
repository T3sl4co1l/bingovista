/* * * Constants and Defaults * * */

/* HTML IDs */
const ids = {
	clear: "clear",
	textbox: "textbox",
	parse: "parse",
	load: "fileload",
	drop: "droptarget",
	board: "board",
	cursor: "cursor",
	square: "square",
	desc: "desctxt",
	message: "errorbox",
	darkstyle: "darkmode",
	radio1: "dark",
	radio2: "light",
	detail: "kibitzing"
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
	{ img: "bingoicons.png",   txt: "bingoicons.txt",   canv: undefined, frames: {} },	/**< from Bingo mod */
	{ img: "uispritesmsc.png", txt: "uispritesmsc.txt", canv: undefined, frames: {} }, 	/**< from DLC */
	{ img: "uiSprites.png",    txt: "uiSprites.txt",    canv: undefined, frames: {} } 	/**< from base game */
];

/* Bingo square graphics dimensions (in px) */
const square = {
	width: 85,
	height: 85,
	margin: 4,
	border: 2,
	color: "#ffffff",
	background: "#020204",
	font: "600 10pt \"Segoe UI\", sans-serif"
};

var board;

var selected;

/** Flag to reveal full detail on otherwise-hidden challenges (e.g. Vista Points), and extended commentary */
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
	document.getElementById(ids.board).addEventListener("keydown", navSquares);
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
		selectSquare( {
			offsetX: selected.col * (square.width + square.margin + square.border) + (square.border + square.margin) / 2 + 1,
			offsetY: selected.row * (square.width + square.margin + square.border) + (square.border + square.margin) / 2 + 1
		} );
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
	s = s.trim().replace(/\s*bChG\s*/g, "bChG");
	document.getElementById(ids.textbox).value = s;
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
					board.goals[board.goals.length - 1].description = e.message + "<br>Descriptor: " + desc.join("><");
				}
			} else {
				board.goals.push(defaultGoal(type, desc));
			}
		} else {
			board.goals.push(CHALLENGES["BingoChallenge"](goals[i]));
		}
	}

	function defaultGoal(t, d) {
		return {
			name: t,
			category: t,
			items: [],
			description: "Error generating goal. Descriptor: " + d.join("><"),
			values: [],
			paint: [
				{ type: "text", value: "∅", scale: 1, color: "#ffffff", rotation: 0 }
			]
		};
	}

	if (selected !== undefined) {
		//	See if we can re-select the same square (position) in the new board
		if (selected.row < board.height && selected.col < board.width) {
			selectSquare( {
				offsetX: selected.col * (square.width + square.margin + square.border) + (square.border + square.margin) / 2 + 1,
				offsetY: selected.row * (square.width + square.margin + square.border) + (square.border + square.margin) / 2 + 1
			} );
		} else {
			selected = undefined;
		}
	}
	if (selected === undefined)
		selectSquare( { offsetX: -1, offsetY: -1 } );

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

}

/**
 *	Clicked on canvas.
 */
function selectSquare(e) {
	var el = document.getElementById(ids.desc);
	var ctx = document.getElementById(ids.square).getContext("2d");
	if (board !== undefined) {
		var x = e.offsetX - (square.border + square.margin) / 2;
		var y = e.offsetY - (square.border + square.margin) / 2;
		var sqWidth = square.width + square.margin + square.border;
		var sqHeight = square.width + square.margin + square.border;
		var col = Math.floor(x / sqWidth);
		var row = Math.floor(y / sqHeight);
		if (x >= 0 && y >= 0 && (x % sqWidth) < (sqWidth - square.margin)
				&& (y % sqHeight) < (sqHeight - square.margin)
				&& row < board.height && col < board.width) {

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

			while (el.firstChild)
				el.removeChild(el.firstChild);
			var s = "<div class=\"descch\">Challenge: " + goal.category + "</div>\n";
			s += "<div class=\"descdesc\">" + goal.description + "</div>";
			s += "<table class=\"desclist\">\n";
			s += "<thead><tr><td>Parameter</td><td>Value</td></tr></thead>\n<tbody>\n";
			for (var i = 0; i < goal.items.length && i < goal.values.length; i++) {
				if (goal.items[i].length > 0) {
					s += "  <tr><td>" + goal.items[i] + "</td><td>" + goal.values[i] + "</td></tr>\n";
				}
			}
			s += "</tbody></table>\n";
			if (kibitzing && goal.comments.length > 0)
				s += "<div class=\"desccomm\">" + goal.comments + "</div>";
			el.innerHTML = s;

			//	position cursor
			//<div id="cursor" style="width: 39px; height: 39px; margin: 0; border: 1px solid #b8b8b8; border-radius: 3px; position: absolute; top: 1px; left: 1px; z-index: 2;"></div>
			var curSty = document.getElementById(ids.cursor).style;
			curSty.width = String(square.width + square.border) + "px";
			curSty.height = String(square.height + square.border) + "px";
			curSty.left = String(square.margin / 2 - 1 + col * (square.width + square.border + square.margin)) + "px";
			curSty.top = String(square.margin / 2 - 1 + row * (square.width + square.border + square.margin)) + "px";
			curSty.display = "initial";
			return;
		}
	}
	clearDescription();

	function clearDescription() {
		selected = undefined;
		ctx.fillStyle = square.background;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		while (el.firstChild)
			el.removeChild(el.firstChild);
		el.appendChild(document.createTextNode("Select a square to view details."));
		document.getElementById(ids.cursor).style.display = "none";
	}
}

/**
 *	Key input to document; pare down to arrow keys for navigating squares
 */
function navSquares(e) {
	if ((e.target.id == ids.board || e.target.id == ids.cursor) && board !== undefined) {
		var dRow = 0, dCol = 0;
		if (e.key == "Up"    || e.key == "ArrowUp"   ) dRow = -1;
		if (e.key == "Down"  || e.key == "ArrowDown" ) dRow = 1;
		if (e.key == "Left"  || e.key == "ArrowLeft" ) dCol = -1;
		if (e.key == "Right" || e.key == "ArrowRight") dCol = 1;
		if (dRow || dCol) {
			e.preventDefault();
			if (selected === undefined) selected = { row: 0, col: 0 };
			selected.row += dRow; selected.col += dCol;
			if (selected.row < 0) selected.row += board.height;
			if (selected.row >= board.height) selected.row -= board.height;
			if (selected.col < 0) selected.col += board.width;
			if (selected.col >= board.width) selected.col -= board.width;
			selectSquare( {
					offsetX: selected.col * (square.width + square.margin + square.border) + (square.border + square.margin) / 2 + 1,
					offsetY: selected.row * (square.width + square.margin + square.border) + (square.border + square.margin) / 2 + 1
			} );
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
 *	Challenge classes from Bingomod decomp.
 */
const CHALLENGES = {
	BingoChallenge: function(desc) {
		const thisname = "BingoChallenge";
		//	Keep as template and default
		return {
			name: thisname,
			category: "Empty challenge class",
			items: [],
			values: [],
			description: "Descriptor: " + desc,
			comments: "",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoAchievementChallenge: function(desc) {
		const thisname = "BingoAchievementChallenge";
		//	assert: desc of format ["System.String|Traveller|Passage|0|passage", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Passage", , "passage"], "goal selection");
		return {
			name: thisname,
			category: "Obtaining Passages",
			items: ["Passage"],
			values: [items[1]],
			description: "Earn " + (passageToDisplayNameMap[items[1]] || "unknown") + " passage.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoKarmaFlowerChallenge: function(desc) {
		const thisname = "BingoKarmaFlowerChallenge";
		//	assert: desc of format ["0", "System.Int32|5|Amount|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount", , "NULL"], "item count");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > 30000)
			throw new TypeError(thisname + ": error, amount " + items[1] + " not a number or out of range");
		return {
			name: thisname,
			category: "Consuming Karma Flowers",
			items: [items[2]],
			values: [items[1]],
			description: "Consume " + creatureNameQuantify(amt, "Karma Flowers") + ".",
			comments: "With this goal present on the board, flowers are spawned in the world in their normal locations. The player obtains the benefit of consuming the flower (protecting karma level). While the goal is in progress, players <em>do not drop</em> the flower on death. After the goal is completed or locked, a flower can drop on death as normal.",
			paint: [
				{ type: "icon", value: "foodSymbol", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: "FlowerMarker", scale: 1, color: colorFloatToString(RainWorldColors.SaturatedGold), rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + items[1] + "]", color: "#ffffff" }
			]
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
		if (isNaN(amt) || amt < 0 || amt > 30000)
			throw new TypeError(thisname + ": error, amount " + v[2] + " not a number or out of range");
		var c = String(amt) + " creatures";
		if (v[0] != "Any Creature") {
			if (creatureNameToDisplayTextMap[v[0]] === undefined)
				throw new TypeError(thisname + ": error, creature type '" + v[0] + "' not found in creatureNameToDisplayTextMap[]");
			c = creatureNameQuantify(amt, creatureNameToDisplayTextMap[v[0]]);
		}
		if (v[3] != "Any Region") {
			r = (regionCodeToDisplayName[v[3]] || "") + " / " + (regionCodeToDisplayNameSaint[v[3]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r == "")
				throw new TypeError(thisname + ": error, region selection " + v[3] + " not found in regionCodeToDisplayName[]");
			r = " in " + r;
		}
		if (v[4] != "Any Subregion") {
			r = " in " + v[4];
			if (BingoEnum_AllSubregions[v[4]] === undefined)
				throw new TypeError(thisname + ": error, subregion selection " + v[4] + " not found in BingoEnum_AllSubregions[]");
		}
		var w = ", with a death pit";
		if (!BingoEnum_Weapons.includes(v[1]))
			throw new TypeError(thisname + ": error, weapon selection " + v[1] + " not found in BingoEnum_Weapons[]");
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
				p.push( { type: "icon", value: "deathpiticon", scale: 1, color: "#ffffff", rotation: 0 } );
			else
				p.push( { type: "icon", value: itemNameToIconAtlasMap[v[1]], scale: 1, color: itemToColor(v[1]), rotation: 0 } );
		}
		if (v[5] != "true" && v[5] != "false")
			throw new TypeError(thisname + ": error, one-cycle flag " + v[5] + " not 'true' or 'false'");
		if (v[6] != "true" && v[6] != "false")
			throw new TypeError(thisname + ": error, death pit flag " + v[6] + " not 'true' or 'false'");
		if (v[7] != "true" && v[7] != "false")
			throw new TypeError(thisname + ": error, starving flag " + v[7] + " not 'true' or 'false'");
		p.push( { type: "icon", value: "Multiplayer_Bones", scale: 1, color: "#ffffff", rotation: 0 } );
		if (v[0] != "Any Creature") {
			p.push( { type: "icon", value: creatureNameToIconAtlasMap[v[0]], scale: 1,
					color: creatureToColor(v[0]), rotation: 0 } );
		}
		p.push( { type: "break" } );
		if (v[4] == "Any Subregion") {
			if (v[3] != "Any Region") {
				p.push( { type: "text", value: v[3], color: "#ffffff" } );
				p.push( { type: "break" } );
			}
		} else {
			p.push( { type: "text", value: v[4], color: "#ffffff" } );
			p.push( { type: "break" } );
		}
		p.push( { type: "text", value: "[0/" + v[2] + "]", color: "#ffffff" } );
		if (v[7] == "true")
			p.push( { type: "icon", value: "Multiplayer_Death", scale: 1, color: "#ffffff", rotation: 0 } );
		if (v[5] == "true")
			p.push( { type: "icon", value: "cycle_limit", scale: 1, color: "#ffffff", rotation: 0 } );
		return {
			name: thisname,
			category: "Killing creatures",
			items: i,
			values: v,
			description: "Kill " + c + r + w
					+ ((v[7] == "true") ? ", while starving" : "")
					+ ((v[5] == "true") ? ", in one cycle"   : "") + ".",
			comments: "(If defined, subregion takes precedence over region. If set, Death Pit takes precedence over weapon selection.)<br>Credit is determined by the last source of 'blame' at time of death. For creatures that take multiple hits, try to \"soften them up\" with more common items, before using limited ammunition to deliver the killing blow.  Creatures that \"bleed out\", can be mortally wounded (brought to or below 0 HP), before being tagged with a specific weapon to obtain credit. Starving: must be in the \"malnourished\" state; this state is cleared after eating to full.",
			paint: p
		};
	},
	BingoMaulTypesChallenge: function(desc) {
		const thisname = "BingoMaulTypesChallenge";
		//
		return {
			name: thisname,
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
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
			category: thisname,
			items: [],
			values: [],
			description: "Not yet implemented.",
			comments: "",
			paint: [
				{ type: "text", value: "∅", color: "#ffffff" }
			]
		};
	},
	BingoStealChallenge: function(desc) {
		const thisname = "BingoStealChallenge";
		//	assert: desc of format ["System.String|Rock|Item|1|theft",
		//	"System.Boolean|false|From Scavenger Toll|0|NULL",
		//	"0", "System.Int32|3|Amount|2|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var v = [], i = [];
		var p = [ { type: "icon", value: "steal_item", scale: 1, color: "#ffffff", rotation: 0 } ];
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Item", , "theft"], "item selection"); v.push(items[1]); i.push(items[2]);
		if (!BingoEnum_theft.includes(v[0]))
			throw new TypeError(thisname + ": error, item " + v[0] + " not found in BingoEnum_theft[]");
		items = checkSettingbox(thisname, desc[3], ["System.Int32", , "Amount", , "NULL"], "item count"); v.push(items[1]); i.push(items[2]);
		items = checkSettingbox(thisname, desc[1], ["System.Boolean", , "From Scavenger Toll", , "NULL"], "venue flag"); v.push(items[1]); i.push(items[2]);
		if (itemNameToDisplayTextMap[v[0]] === undefined)
			throw new TypeError(thisname + ": error, item selection " + v[2] + " not found in itemNameToDisplayTextMap[]");
		var amt = parseInt(v[1]);
		if (isNaN(amt) || amt < 0 || amt > 30000)
			throw new TypeError(thisname + ": error, amount " + v[1] + " not a number or out of range");
		var d = "Steal " + String(amt) + " " + itemNameToDisplayTextMap[v[0]] + " from ";
		p.push( { type: "icon", value: itemNameToIconAtlasMap[v[0]], scale: 1,
				color: itemToColor(v[0]), rotation: 0 } );
		if (v[2] == "true") {
			p.push( { type: "icon", value: "scavtoll", scale: 0.8, color: "#ffffff", rotation: 0 } );
			d += "a Scavenger Toll.";
		} else if (v[2] == "false") {
			p.push( { type: "icon", value: creatureNameToIconAtlasMap["Scavenger"], scale: 1,
					color: creatureToColor("Scavenger"), rotation: 0 } );
			d += "Scavengers.";
		} else {
			throw new TypeError(thisname + ": error, venue flag " + v[2] + " not 'true' or 'false'");
		}
		p.push( { type: "break" } );
		p.push( { type: "text", value: "[0/" + v[1] + "]", color: "#ffffff" } );
		return {
			name: thisname,
			category: "Stealing items",
			items: i,
			values: v,
			description: d,
			comments: "",
			paint: p
		};
	},
	BingoTameChallenge: function(desc) {
		const thisname = "BingoTameChallenge";
		//	assert: desc of format ["System.String|EelLizard|Creature Type|0|friend", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Creature Type", , "friend"], "creature type");
		if (!BingoEnum_Befriendable.includes(items[1]))
			throw new TypeError(thisname + ": error, creature type '" + items[1] + "' not Befriendable");
		var d = creatureNameToDisplayTextMap[items[1]];
		if (d === undefined)
			throw new TypeError(thisname + ": error, creature type '" + items[1] + "' not found in creatureNameToDisplayTextMap[]");
		d = creatureNameQuantify(1, d);
		return {
			name: thisname,
			category: "Befriending a creature",
			items: ["Creature Type"],
			values: [items[1]],
			description: "Befriend " + d + ".",
			comments: "Taming occurs when a creature has been fed or rescued enough times to increase the player's reputation above some threshold, starting from a default depending on species, and the global and regional reputation of the player. Feeding occurs when 1. the player drops an edible item, creature or corpse, 2. within view of the creature, and 3. the creature bites that object. A \"happy lizard noises\" sound indicates success. The creature does not need to den with the item to increase reputation. Stealing the object from the creature's jaws, does not reduce reputation. A rescue occurs when 1. a creature sees or is grabbed by a threat, 2. the player attacks the threat (if the creatures was grabbed, the predator must be stunned enough to drop the creature), and 3. the creature sees the attack (or gets dropped because of it).",
			paint: [
				{ type: "icon", value: "FriendB", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: creatureNameToIconAtlasMap[items[1]], scale: 1,
						color: creatureToColor(items[1]), rotation: 0 }
			]
		};
	},
	BingoTradeChallenge: function(desc) {
		const thisname = "BingoTradeChallenge";
		//	desc of format ["0", "System.Int32|15|Value|0|NULL", "0", "0"]
		checkDescriptors(thisname, desc.length, 4, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Value", , "NULL"], "points value");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > 30000)
			throw new TypeError(thisname + ": error, amount " + items[1] + " not a number or out of range");
		return {
			name: thisname,
			category: "Trading items to Merchants",
			items: [items[2]],
			values: [amt],
			description: "Trade " + String(amt) + " points worth of items to Scavenger Merchants.",
			comments: "A trade occurs when 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. When the Scavenger is also a Merchant, points will be awarded. Beware that Scavenger vision is very narrow and can easily miss one of these three actions. Try to get and hold their attention and be prompt. Any item can be traded once to award points according to its value; this includes items initially held by (then dropped or traded) by Scavengers. If an item seems to have been ignored or missed, try trading it again. Stealing and murder will not result in points awarded.",
			paint: [
				{ type: "icon", value: "scav_merchant", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: "#ffffff" }
			]
		};
	},
	BingoTradeTradedChallenge: function(desc) {
		const thisname = "BingoTradeTradedChallenge";
		//	desc of format ["0", "System.Int32|3|Amount of Items|0|NULL", "empty", "0", "0"]
		checkDescriptors(thisname, desc.length, 5, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.Int32", , "Amount of Items", , "NULL"], "amount of items");
		var amt = parseInt(items[1]);
		if (isNaN(amt) || amt < 0 || amt > 30000)
			throw new TypeError(thisname + ": error, amount " + items[1] + " not a number or out of range");
		return {
			name: thisname,
			category: "Trading already traded items",
			items: [items[2]],
			values: [amt],
			description: "Trade " + String(amt) + ((amt == 1) ? " item" : " items") + " from Scavenger Merchants to other Scavenger Merchants.",
			comments: "A trade occurs when 1. a Scavenger sees you with item in hand, 2. sees you drop the item, and 3. picks up that item. Beware that Scavenger vision is very narrow and can easily miss one of these three actions. Try to get and hold their attention and be prompt. While this challenge is active, any item dropped by a Merchant, in trade, will be \"blessed\" and bear a mark indicating its eligibility for this challenge. In a Merchant room, the Merchant bears a '✓' tag to show who you should trade with; other Scavengers in the room are tagged with 'X'. Stealing from or murdering a Merchant will not result in \"blessed\" items dropping. A \"blessed\" item can then be brought to any <em>other</em> Merchant and traded, to obtain credit towards this goal.",
			paint: [
				{ type: "icon", value: "scav_merchant", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: "Menu_Symbol_Shuffle", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "icon", value: "scav_merchant", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "break" },
				{ type: "text", value: "[0/" + amt + "]", color: "#ffffff" }
			]
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
				throw new TypeError(thisname + ": error, region " + v[0] + " not found in regionCodeToDisplayName[]");
		}
		if (r2 != "Any Region") {
			r2 = (regionCodeToDisplayName[v[1]] || "") + " / " + (regionCodeToDisplayNameSaint[v[1]] || "");
			r2 = r2.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r2 == "")
				throw new TypeError(thisname + ": error, region " + v[1] + " not found in regionCodeToDisplayName[]");
		}
		if (creatureNameToDisplayTextMap[v[2]] === undefined)
			throw new TypeError(thisname + ": error, creature type " + v[2] + " not found in creatureNameToDisplayTextMap[]");
		if (!BingoEnum_Transportable.includes(v[2]))
			throw new TypeError(thisname + ": error, creature type " + v[2] + " not Transportable");
		var p = [
			{ type: "icon", value: creatureNameToIconAtlasMap[v[2]], scale: 1, color: creatureToColor(v[2]), rotation: 0 },
			{ type: "break" }
		];
		if (p[0].value === undefined || p[0].color === undefined)
			throw new TypeError(thisname + ": error, token " + v[2] + " not found in itemNameToIconAtlasMap[] or Color");
		if (v[0] != "Any Region") p.push( { type: "text", value: v[0], color: "#ffffff" } );
		p.push( { type: "icon", value: "singlearrow", scale: 1, color: "#ffffff", rotation: 0 } );
		if (v[1] != "Any Region") p.push( { type: "text", value: v[1], color: "#ffffff" } );
		return {
			name: thisname,
			category: "Transporting creatures",
			items: i,
			values: v,
			description: "Transport " + creatureNameQuantify(1, creatureNameToDisplayTextMap[v[2]]) + " from " + r1 + " to " + r2,
			comments: "",
			paint: p
		};
	},
	BingoUnlockChallenge: function(desc) {
		const thisname = "BingoUnlockChallenge";
		//	desc of format ["System.String|SingularityBomb|Unlock|0|unlocks", "0", "0"]
		checkDescriptors(thisname, desc.length, 3, "parameter item count");
		var items = checkSettingbox(thisname, desc[0], ["System.String", , "Unlock", , "unlocks"], "unlock selection");
		var iconName = "", iconColor = [];
		var p = [
			{ type: "icon", value: "arenaunlock", scale: 1, color: "#ffffff", rotation: 0 },
			{ type: "break" }
		];
		var d = "Get the ", r;
		if (BingoEnum_ArenaUnlocksBlue.includes(items[1])) {
			p[0].color = colorFloatToString(RainWorldColors.AntiGold);
			iconName = creatureNameToIconAtlasMap[items[1]] || itemNameToIconAtlasMap[items[1]];
			iconColor = creatureNameToIconColorMap[items[1]] || itemNameToIconColorMap[items[1]] || creatureNameToIconColorMap["Default"];
			r = creatureNameToDisplayTextMap[items[1]] || itemNameToDisplayTextMap[items[1]];
			if (iconName === undefined || r === undefined)
				throw new TypeError(thisname + ": error, token " + items[1] + " not found in itemNameToIconAtlasMap[] (or creature-, or Color or DisplayText)");
			d += r;
		} else if (BingoEnum_ArenaUnlocksGold.includes(items[1])) {
			p[0].color = colorFloatToString(RainWorldColors.TokenDefault);
			r = (regionCodeToDisplayName[items[1]] || "") + " / " + (regionCodeToDisplayNameSaint[items[1]] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r == "") {
				r = arenaUnlocksGoldToDisplayName[items[1]];
				if (r === undefined)
					throw new TypeError(thisname + ": error, arena " + items[1] + " not found in arenaUnlocksGoldToDisplayName[]");
			}
			d += r + " Arenas";
		} else if (BingoEnum_ArenaUnlocksGreen.includes(items[1])) {
			p[0].color = colorFloatToString(RainWorldColors.GreenColor);
			iconName = "Kill_Slugcat";
			iconColor = RainWorldColors["Slugcat_" + items[1]];
			if (iconColor === undefined)
				throw new TypeError(thisname + ": error, token Slugcat_" + items[1] + " not found in RainWorldColors[]");
			d += items[1] + " character"
		} else if (BingoEnum_ArenaUnlocksRed.includes(items[1])) {
			p[0].color = colorFloatToString(RainWorldColors.RedColor);
			r = items[1].substring(0, items[1].search("-"));
			r = (regionCodeToDisplayName[r] || "") + " / " + (regionCodeToDisplayNameSaint[r] || "");
			r = r.replace(/^\s\/\s|\s\/\s$/g, "");
			if (r == "")
				throw new TypeError(thisname + ": error, region " + items[1].substring(0, items[1].search("-")) + " not found in regionCodeToDisplayName[]");
			d += r + " Safari";
		} else {
			throw new TypeError(thisname + ": error, token " + items[1] + " not found in BingoEnum_ArenaUnlocks[]");
		}
		if (iconName == "")
			p.push( { type: "text", value: items[1], color: "#ffffff" } );
		else
			p.push( { type: "icon", value: iconName, scale: 1, color: colorFloatToString(iconColor), rotation: 0 } );
		return {
			name: thisname,
			category: "Getting Arena Unlocks",
			items: ["Unlock"],
			values: [items[1]],
			description: d + " unlock.",
			comments: "",
			paint: p
		};
	},
	BingoVistaChallenge: function(desc) {
		const thisname = "BingoVistaChallenge";
		//	desc of format ["CC", "System.String|CC_A10|Room|0|vista", "734", "506", "0", "0"]
		checkDescriptors(thisname, desc.length, 6, "parameter item count");
		var items = checkSettingbox(thisname, desc[1], ["System.String", , "Room", , "vista"], "item selection");
		//	desc[0] is region code
		if (desc[0] != items[1].substring(0, items[1].search("_")))
			throw new TypeError(thisname + ": error, region " + desc[0] + " does not match room " + items[1] + "'s region");
		var v = (regionCodeToDisplayName[desc[0]] || "") + " / " + (regionCodeToDisplayNameSaint[desc[0]] || "");
		v = v.replace(/^\s\/\s|\s\/\s$/g, "");
		if (v == "")
			throw new TypeError(thisname + ": error, region " + desc[0] + " not found in regionCodeToDisplayName[]");
		return {
			name: thisname,
			category: "Visiting Vistas",
			items: ["Region"],
			values: [desc[0]],
			description: "Reach the vista point in " + v + ".",
			comments: "Room: " + items[1] + " at x: " + desc[2] + ", y: " + desc[3],
			paint: [
				{ type: "icon", value: "vistaicon", scale: 1, color: "#ffffff", rotation: 0 },
				{ type: "break" },
				{ type: "text", value: desc[0], color: "#ffffff" }
			]
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

/**
 *	Assorted color constants that don't belong to any
 *	particular object, type or class.
 */
const RainWorldColors = {
	//	RainWorld (global consts?), HSL2RGB'd and mathed as needed
	"AntiGold":            [0.2245,   0.519817, 0.8355 ],
	"GoldHSL":             [0.8355,   0.540183, 0.2245 ],
	"GoldRGB":             [0.529,    0.365,    0.184  ],
	"SaturatedGold":       [1,        0.73,     0.368  ],
	"MapColor":            [0.381333, 0.32,     0.48   ],
	//	CollectToken
	"RedColor":            [1,        0,        0      ],
	"GreenColor":          [0.265234, 0.8355,   0.2245 ],
	"WhiteColor":          [0.53,     0.53,     0.53   ],
	"DevColor":            [0.8648,   0,        0.94   ],
	"TokenDefault":        [1,        0.6,      0.05   ],	//	BingoUnlockChallenge::IconDataForUnlock "gold" default
	//	PlayerGraphics::DefaultSlugcatColor, prepended with "Slugcat_"
	"Slugcat_White":       [1,        1,        1      ],
	"Slugcat_Yellow":      [1,        1,        0.45098],
	"Slugcat_Red":         [1,        0.45098,  0.45098],
	"Slugcat_Night":       [0.092,    0.1388,   0.308  ],
	"Slugcat_Sofanthiel":  [0.09,     0.14,     0.31   ],
	"Slugcat_Rivulet":     [0.56863,  0.8,      0.94118],
	"Slugcat_Artificer":   [0.43922,  0.13725,  0.23529],
	"Slugcat_Saint":       [0.66667,  0.9451,   0.33725],
	"Slugcat_Spear":       [0.31,     0.18,     0.41   ],
	"Slugcat_Spearmaster": [0.31,     0.18,     0.41   ],	//	avoid special cases detecting "Spear" vs. "Spearmaster"
	"Slugcat_Gourmand":    [0.94118,  0.75686,  0.59216]
};

/**
 *	Convert creature value string to display text.
 *	Game extract: ChallengeTools::CreatureName
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
	"Default":          "Unknown Item"
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
	"SL_moon":          "Pale Yellow",
	"Spearmasterpearl": "Dark Red",
	"SU_filt":          "Light Pink"
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


/* * * Utility Functions * * */

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
			throw new TypeError(t + ": " + err + ", found " + items[i] + ", expected: " + String(f[i]));
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
	if (typeof(d) === "string") s = "'" + s + "'";
	if (typeof(g) === "string") h = "'" + h + "'";
	if (d != g) throw new TypeError(t + ": error, " + err + " " + s + ", expected: " + h);
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

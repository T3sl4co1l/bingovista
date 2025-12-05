var bv;

document.addEventListener("DOMContentLoaded", function() {
	//	Set up DOM elements and listeners

	document.getElementById("boardcontainer").innerHTML = "Load a board...";
	bv = new Bingovista( {
		headerId: "header",
		boardId: "boardcontainer",
		selectId: "descsq",
		detailId: "desctxt",
		cursor: true,
		tips: document.getElementById("kibitzing").checked,
		transpose: document.getElementById("transp").checked,
		loadFail: loadFail,
		loadSuccess: loadSuccess,
	} );

	//	Nav, header and file handling buttons
	document.getElementById("boardcontainer").addEventListener("keydown", navSquares);
	document.getElementById("kibitzing").addEventListener("input", toggleKibs);
	document.getElementById("transp").addEventListener("input", toggleTransp);
	document.getElementById("textbox").addEventListener("paste", pasteText);
	document.getElementById("clear").addEventListener("click", clearText);
	document.getElementById("parse").addEventListener("click", parseButton);
	document.getElementById("copy").addEventListener("click", copyText);

	document.getElementById("fileload").addEventListener("change", (e) => doLoadFile(e.target.files));
	var d = document.getElementById("droptarget");
	d.addEventListener("dragenter", dragEnterOver);
	d.addEventListener("dragover", dragEnterOver);
	d.addEventListener("dragleave", dragLeave);
	d.addEventListener("drop", dragDrop);

	var u = new URL(document.URL).searchParams;
	if (u.has("a")) {
		//	Plain text / ASCII string
		//	very inefficient, unlikely to be used, but provided for completeness
		bv.setup( { dataSrc: u.get("a"), dataType: "text" } );
	} else if (u.has("b")) {
		//	Binary string, base64 encoded
		bv.setup( { dataSrc: u.get("b"), dataType: "base64" } );
	} else if (u.has("q")) {
		//	Query, Bingovista will fetch from remote server to get board data
		bv.setup( { dataSrc: u.get("q"), dataType: "short" } );
	}
});

/**
 *	Key input to board container; pare down to arrow keys for navigating squares
 */
function navSquares(e) {
	if (bv !== undefined && e.target.id === "boardcontainer") {
		var col = 0, row = 0;
		if (e.key === "Left"  || e.key === "ArrowLeft" ) col = -1;
		if (e.key === "Right" || e.key === "ArrowRight") col = 1;
		if (e.key === "Up"    || e.key === "ArrowUp"   ) row = -1;
		if (e.key === "Down"  || e.key === "ArrowDown" ) row = 1;
		if (col || row) {
			e.preventDefault();
			if (bv.selected?.col === undefined || bv.selected?.row === undefined)
				bv.selected = { col: 0, row: 0 };
			if (bv.selected.col < 0 || bv.selected.col >= bv.board.width ) bv.selected.col = 0;
			if (bv.selected.row < 0 || bv.selected.row >= bv.board.height) bv.selected.row = 0;
			col += bv.selected.col; row += bv.selected.row;
			if (row < 0) row += bv.board.height;
			if (row >= bv.board.height) row -= bv.board.height;
			if (col < 0) col += bv.board.width;
			if (col >= bv.board.width) col -= bv.board.width;
			bv.selectSquare(col, row);
		}
	}
}

/**
 *	Kibitzing check toggled.
 */
function toggleKibs(e) {
	bv.setup( { tips: e.target.checked } );
}

/**
 *	Transpose check toggled.
 */
function toggleTransp(e) {
	bv.setup( { transpose: e.target.checked } );
}

/**
 *	Pasted to textbox.
 */
function pasteText(e) {
	//	Let default happen, but trigger a parse in case no edits are required by the user
	setTimeout(parseButton, 10);
}

function loadSuccess(e) {
	document.getElementById("errorbox").innerHTML = "";
	document.getElementById("textbox").value = this.board.text;
	var u = new URL(document.URL);
	u.searchParams.set("b", Bingovista.binToBase64u(this.board.toBin));
	window.history.pushState(null, "", u.href);
}

function loadFail(e) {
	document.getElementById("errorbox").innerHTML = this.board.error;
}

/**
 * Clicked on Clear.
 */
function clearText(e) {
	document.getElementById("textbox").value = "";
	var u = new URL(document.URL);
	u.search = "";
	window.history.pushState(null, "", u.href);
}

/**
 *	Parse Text button pressed.
 */
function parseButton(e) {
	var s = document.getElementById("textbox").value;
	s = s.replace(/;\n+/, ";");
	s = s.trim().replace(/\s*bChG\s*/g, "bChG");
	document.getElementById("textbox").value = s;
	bv.setup( { dataSrc: s, dataType: "text" } );
}

/**
 *	Clicked on Copy.
 */
function copyText(e) {
	navigator.clipboard.writeText(document.getElementById("textbox").value);
	setError("Text copied to clipboard.");
}

function doLoadFile(files) {
	for (var i = 0; i < files.length; i++) {
		if (files[i].type.match("^text/plain")) {
			var fr = new FileReader();
			fr.onload = function() {
				document.getElementById("textbox").value = this.result;
				parseButton();
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
 * Element dragged over drop target.
 */
function dragEnterOver(e) {
	if (e.dataTransfer.types.includes("text/plain")
			|| e.dataTransfer.types.includes("Files")) {
		e.preventDefault();
		e.target.style.backgroundColor = "#686868";
	}
}

/**
 * Element dragged away from drop target.
 */
function dragLeave(e) {
	// maybe :-moz-drag-over css pseudoclass will one day be standard...that'd be handy here
	e.target.style.backgroundColor = "";
}

/**
 *	Data dropped onto the page.
 */
function dragDrop(e) {
	e.preventDefault();
	e.target.style.backgroundColor = "";
	var d = e.dataTransfer;
	setError("");
	if (d.types.includes("Files")) {
		doLoadFile(d.files);
	} else {
		var s;
		for (var i = 0; i < d.items.length; i++) {
			if (d.items[i].type.match("^text/plain")) {
				d.items[i].getAsString(function(s) {
					document.getElementById("textbox").value = s;
					parseButton();
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
	var mb = document.getElementById("errorbox");
	while (mb.childNodes.length) mb.removeChild(mb.childNodes[0]);
	mb.appendChild(document.createTextNode(s));
}

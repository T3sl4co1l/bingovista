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
	bv.refreshHeader = createRefreshHeader;
	bv.setup( { dataSrc: "Any;", dataType: "text" } );

	//	Nav, header and file handling buttons
	document.getElementById("boardcontainer").addEventListener("keydown", navSquares);
	document.getElementById("kibitzing").addEventListener("input", toggleKibs);
	document.getElementById("transp").addEventListener("input", toggleTransp);
	document.getElementById("textbox").addEventListener("paste", pasteText);
	document.getElementById("clear").addEventListener("click", clearText);
	document.getElementById("parse").addEventListener("click", parseButton);
	document.getElementById("maketext").addEventListener("click", makeText);
	document.getElementById("copy").addEventListener("click", copyText);
	document.getElementById("link").addEventListener("click", viewBoard);
	document.getElementById("short").addEventListener("click", shortenLink);
	document.getElementById("shortenboxb").addEventListener("click", copyShort);
	document.getElementById("fileload").addEventListener("change", (e) => doLoadFile(e.target.files));
	var d = document.getElementById("droptarget");
	d.addEventListener("dragenter", dragEnterOver);
	d.addEventListener("dragover", dragEnterOver);
	d.addEventListener("dragleave", dragLeave);
	d.addEventListener("drop", dragDrop);

});

/**
 *	Data loaded callback.
 */
function loadSuccess(e) {
	setError("Loaded.");
	document.getElementById("textbox").value = this.board.text;
}

/**
 *	Data load failure callback.
 */
function loadFail(e) {
	setError("Bingovista error: " + this.board.error);
}

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

/**
 * Clicked on Clear.
 */
function clearText(e) {
	document.getElementById("textbox").value = "";
}

/**
 *	Clicked on Load Board.
 */
function parseButton(e) {
	var s = document.getElementById("textbox").value;
	s = s.replace(/;\n+/, ";");
	s = s.trim().replace(/\s*bChG\s*/g, "bChG");
	bv.setup( { dataSrc: s, dataType: "text" } );
}

/**
 *	Clicked on Refresh Text.
 */
function makeText(e) {
	document.getElementById("textbox").value = boardToString(bv.board);
	setError("Ready.");
}

/**
 *	Clicked on Copy.
 */
function copyText(e) {
	navigator.clipboard.writeText(document.getElementById("textbox").value);
	setError("Text copied to clipboard.");
}

/**
 *	Clicked on Link.
 */
function viewBoard(e) {
	var u = new URL("bingovista.html", document.URL);
	u.searchParams.set("b", Bingovista.binToBase64u(bv.boardToBin()));
	var a = document.createElement("a");
	a.href = u.href;
	a.target = "_blank";
	a.click();
}

/**
 *	Clicked on Shorten.
 */
function shortenLink(e) {
	document.getElementById("shortenbox").showModal();
	var titl = document.getElementById("shortenboxt");
	var lnk = document.getElementById("shortenboxv");
	var copy = document.getElementById("shortenboxb");
	titl.style.display = "block";
	while (titl.childNodes.length) titl.removeChild(titl.childNodes[0]);
	titl.appendChild(document.createTextNode("Just a moment..."));
	lnk.style.display = "none";
	lnk.value = "";
	copy.disabled = true;

	fetch(
		new URL("https://www.seventransistorlabs.com/bserv/BingoServer.dll"),
		{
			method: "POST",
			body: bv.boardToBin(),
			headers: { "content-type": "application/octet-stream" }
		}
	).then(function(r) {
		//	Request succeeds
		//console.log("Response: " + r.status + ", content-type: " + r.headers.get("content-type"));
		return r.arrayBuffer().then(function(a) {
			//	success, arrayBuffer() complete
			var s = new TextDecoder().decode(new Uint8Array(a));
			var resp;
			try {
				resp = JSON.parse(s);
			} catch (e) {
				while (titl.childNodes.length) titl.removeChild(titl.childNodes[0]);
				titl.appendChild(document.createTextNode("An error occurred."));
				console.log("Server accepted request; error parsing response: \"" + s + "\"");
				return;
			}
			if (resp.status === undefined || resp.cause === undefined || resp.key === undefined) {
				while (titl.childNodes.length) titl.removeChild(titl.childNodes[0]);
				titl.appendChild(document.createTextNode("An error occurred."));
				console.log("Server returned unexpected response; status: " + resp.status + ", cause: " + resp.cause + ", key: " + resp.key);
				return;
			}
			if (resp.cause === "exists") console.log("Board already exists, or collision occurred.");
			var u = new URL("bingovista.html", document.URL);
			u.searchParams.set("q", resp.key);
			lnk.value = u.href;
			lnk.style.display = "inline-block";
			titl.style.display = "none";
			copy.disabled = false;
		} );
	}, function(r) {
		//	Request failed (connection, invalid CORS, etc. error)
		while (titl.childNodes.length) titl.removeChild(titl.childNodes[0]);
		titl.appendChild(document.createTextNode("Error connecting to server."));
	} );

}

/**
 *	Clicked on Shorten/Copy.
 */
function copyShort(e) {
	console.log("copy!");
	if (e.target.disabled === false)
		navigator.clipboard.writeText(document.getElementById("shortenboxv").value);
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
	setError("Ready.");
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


/* * * Bingovista Overrides * * */

/**
 *	Create and assign header table from board data.
 */
function createRefreshHeader() {
	if (this.headerId === undefined || this.board === undefined) return;
	const elem = document.getElementById(this.headerId);
	if (elem === null) return;

	//	Get references to all required elements
	var rows = {}, checks = [], tb = elem?.children[0]?.children[0];
	var names = ["title", "size", "char", "shel", "perkb", "perks", "mods"];
	var indices = [
		[0, 1, 0], [1, 1], [2, 1, 0], [3, 1, 0], [4, 1, 0, 0], [4, 1, 1], [5, 1]
	];
	var flag = (tb === undefined);
	for (var i = 0; i < names.length && !flag; i++) {
		rows[names[i]] = tb;
		flag = flag || (rows[names[i]] === undefined);
		if (flag) break;
		for (var j in indices[i]) {
			rows[names[i]] = rows[names[i]]?.children[indices[i][j]];
			flag = flag || (rows[names[i]] === undefined);
			if (flag) break;
		}
	}
	for (i = 0; i < this.maps.expflags.length && !flag; i++) {
		checks.push(rows.perks.children[i]?.children[0]);
		flag = flag || (checks[i] === undefined);
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
		var inp = document.createElement("input");
		inp.type = "text";
		inp.size = "20";
		inp.value = this.board.comments || "Untitled";
		inp.addEventListener("input", function(e) { bv.board.comments = e.target.value; } );
		rows.title.appendChild(inp);
		var not = document.createElement("span");
		not.style.fontSize = "16px";
		not.appendChild(document.createTextNode("¬"));
		rows.title.appendChild(not);
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
		var sel = document.createElement("select"), opt;
		for (var i in bv.maps.characters) {
			opt = document.createElement("option");
			opt.appendChild(document.createTextNode(bv.maps.characters[i].text));
			sel.appendChild(opt);
		}
		sel.addEventListener("input", function(e) { bv.board.character = e.target.value; } );
		rows.char.appendChild(sel);
		tr.appendChild(rows.char);
		tbd.appendChild(tr);

		tr = document.createElement("tr");
		rows.shel = document.createElement("td");
		rows.shel.appendChild(document.createTextNode("Shelter"));
		tr.appendChild(rows.shel);
		rows.shel = document.createElement("td");
		inp = document.createElement("input");
		inp.type = "text";
		inp.size = "20";
		inp.value = this.board.shelter || "random";
		inp.addEventListener("input", function(e) { bv.board.shelter = e.target.value; } );
		rows.shel.appendChild(inp);
		not = document.createElement("span");
		not.style.fontSize = "16px";
		not.appendChild(document.createTextNode("¬"));
		rows.shel.appendChild(not);
		tr.appendChild(rows.shel);
		tbd.appendChild(tr);

		tr = document.createElement("tr");
		var perktd = document.createElement("td");
		perktd.appendChild(document.createTextNode("Perks/flags"));
		tr.appendChild(perktd);
		perktd = document.createElement("td");
		tr.appendChild(perktd);
		perktd.addEventListener("input", function() { bv.board.perks = getPerks() || 0 } );
		rows.perks = document.createElement("div");
		rows.perks.setAttribute("style", "margin-bottom: 4px;");
		rows.perkb = document.createElement("button");
		rows.perkb.setAttribute("class", "rw-ui");
		rows.perkb.appendChild(document.createTextNode("SHOW/HIDE"));
		rows.perkb.style.width = "7.2em";
		rows.perkb.addEventListener("click", this.clickShowPerks);
		rows.perks.appendChild(rows.perkb);
		perktd.appendChild(rows.perks);
		rows.perks = document.createElement("div");
		rows.perks.setAttribute("style", "margin-bottom: 4px; display: none;");
		perktd.appendChild(rows.perks);
		var p = this.board.perks || 0;
		checks = [];
		for (var i = 0; i < this.maps.expflags.length; i++) {
			checks.push(document.createElement("input"));
			checks[i].setAttribute("type", "checkbox");
			checks[i].setAttribute("class", "bv-perkscheck");
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
	rows.title.value = this.board.comments || "Untitled";
	while (rows.size.childNodes.length) rows.size.removeChild(rows.size.childNodes[0]);
	rows.size.appendChild(document.createTextNode(String(this.board.width) + " x " + String(this.board.height)));
	rows.char.value = this.board.character;
	rows.shel.value = this.board.shelter || "random";

	//	Set perks
	var p = this.board.perks || 0;
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

function getPerks() {
	if (bv.headerId === undefined || bv.board === undefined) return;
	const elem = document.getElementById(bv.headerId);
	if (elem === null) return;

	//	Get references to all required elements
	var perks = elem?.children[0]?.children[0]?.children[4]?.children[1]?.children[1];
	if (perks === undefined) return;
	var checks = [];
	for (var i = 0; i < bv.maps.expflags.length; i++) {
		checks.push(perks.children[i]?.children[0]);
		if (checks[i] === undefined) return;
	}
	var perksVal = 0;
	for (i in bv.maps.expflags)
		if (checks[i].checked) perksVal |= bv.maps.expflags[i].value;
	return perksVal;
}

/**
 *	Applies header parameters to a board's existing text string.
 *	@param b  board object to convert
 */
function boardToString(b) {
	var s = (bv.maps.characters.find(o => o.text === b.character)?.name || "Any") + ";";
	s += (b.shelter || "random") + ";";
	//	TODO: iterate b.goals and toString them (from abstract
	//	representation, when such implementation becomes available)
	var goals = b.text.split(/bChG/);
	var header = goals[0].split(";");
	goals[0] = header[header.length - 1];
	s += goals.join("bChG");

	return s;
}

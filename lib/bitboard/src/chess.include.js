"use strict";

/** @param {string} file */
function include(file) {
	document.write('<script type="text/javascript" src="./src/' + file + '"></script>');
}

include("chess.js");
include("bitboard.js");
include("zobrist.js");
include("move.js");
include("position.js");
include("parser.js");
include("ai.js");
include("ui.js");

//window['Chess'] = Chess;
//window['makeChessGame'] = makeChessGame;
window['foobar'] = "foobar";

//goog.exportSymbol('Chess', Chess);
//goog.exportSymbol('MakeChessGame', makeChessGame);


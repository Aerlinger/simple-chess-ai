var board;
// var game = new Chess();

var position = makeChessGame().chessPosition;

var FLAG_EXACT = 0;
var FLAG_UPPER = 1;
var FLAG_LOWER = 2;

/* Zobrist hashing algorithm */


/**
 * Returns function which accepts a board object as its only parameter and returns a unique hash value based on that
 * board's position.
 *
 * This function is curried so it only needs to be called once. The returned hash function can be called many times.
 */
function setupZobristHashing() {
    var N_BITS = 32;

    var pieceValues = {
        'w': {
            'p': 1,  // White pawn
            'r': 2,  // White rook
            'n': 3,  // White knight
            'b': 4,  // White bishop
            'q': 5,  // White queen
            'k': 6   // White king
        },

        'b': {
            'p': 7,  // Black pawn
            'r': 8,  // Black rook
            'n': 9,  // Black knight
            'b': 10, // Black bishop
            'q': 11, // Black queen
            'k': 12  // Black king
        }
    };

    var zobristLookupTable = [];

    // For each of the 64 squares on the board
    for (var i = 0; i < 64; ++i) {
        zobristLookupTable.push(new Uint32Array(12));

        // For each of the 12 possible piece types (i.e. entries in `pieceValues` maps 6 piece types for each player color)
        for (var j = 0; j < 12; ++j) {
            var randomBitstring = Math.random() * Math.pow(2, N_BITS);  // Subtract 2 from N_BITS to prevent overflow

            // Each square, piece state maps to a random bitstring which will be used to generate a unique hash value
            zobristLookupTable[i][j] = randomBitstring;
        }
    }

    /**
     * A fast hash function which maps a board state to a unique integer
     */
    return function (board) {
        var h = 0;

        /*
         TODO: It'd be nice if we could iterate over pieces on the board here instead of each of the 64 squares as there
         can only be a maximum of 12 pieces on the board at any given time. I don't think this is easily supported by
         chess.js, however.
         */
        for (var i = 0; i < board.length; ++i) {
            for (var j = 0; j < board.length; ++j) {
                var square = board[i][j];

                if (square) {
                    h ^= (pieceValues[square.color][square.type] * zobristLookupTable[i][j])
                }
            }
        }

        return h
    };
}

var getZobristHash = setupZobristHashing();

/* Transposition table */

/**
 * The transposition table is a large cache of moves we've previously explored with minimax.
 *
 * Storing prior moves allows us to speed up future moves by retrieving the game state of previously explored moves in
 * our decision tree.
 */

// We need to set a limit on the number of moves
var TABLE_SIZE = 2e6;

transpositionTable = new Array(TABLE_SIZE);

/**
 * The transposition table is implemented by a fixed-size array.
 *
 * We can then map a Zobrist hash value of a game state to an index in our array by using a modulus.
 */
var transpositionTableIdx = function(zobristKey) {
    return Math.abs(zobristKey) % TABLE_SIZE;
};

/**
 * Insert a move into the transposition table
 *
 * @param zobristKey A zobrist hash of this move's position
 * @param depth The minimax depth this move was calculated at
 * @param value The best evaluation score for this move's position
 * @param flag Whether or not we exceeded alpha or beta. There are three possibilities:
 *    - alpha/beta were not exceeded (FLAG_EXACT)
 *    - we exceeded alpha (FLAG_UPPER)
 *    - we fell below beta (FLAG_LOWER)
 */
var transpositionTablePut = function (zobristKey, depth, value, move, flag) {
    var idx = transpositionTableIdx(zobristKey);

    var previousValue = transpositionTable[idx];
    var newValue;

    if (previousValue && (previousValue.hash == zobristKey)) {
        if (previousValue.depth > depth) {
            newValue = previousValue;
        }
    } else {
        newValue = {
            hash: zobristKey,
            depth: depth,
            value: value,
            move: move,
            flag: flag
        }
    }

    transpositionTable[idx] = newValue;
};

function sortMoves(moves) {
    /**
     * @param {!Chess.Move} move
     * @return {number}
     * TODO: killer heuristic, history, etc
     */
    function scoreMove(move) {
        var score = move.isCapture() ? ((1 + move.getCapturedPiece()) / (1 + move.getPiece())) : 0;
        score = 6 * score + move.getPiece();
        score = 16 * score + move.getKind();
        score = 64 * score + move.getTo();
        score = 64 * score + move.getFrom();
        return score;
    }

    /**
     * @param {!Chess.Move} a
     * @param {!Chess.Move} b
     * @return {number}
     */
    function compareMoves(a, b) {
        return scoreMove(b) - scoreMove(a);
    }

    moves.sort(compareMoves);
    return moves;
}

/**
 * Fetch a move from the transposition table via a given zobristKey, returns null if no move was found.
 */
var transpositionTableGet = function (zobristKey) {
    var idx = transpositionTableIdx(zobristKey);

    var previousValue = transpositionTable[idx];

    // We need to check the hash matches, since it's possible two different board states can map to the same
    // transposition table index
    if (previousValue && (previousValue.hash == zobristKey)) {
        return previousValue
    } else {
        return null
    }
};

var swapMoves = function (arr, sourceIdx, destIdx) {
    var temp = arr[sourceIdx];

    arr[sourceIdx] = arr[destIdx];
    arr[destIdx] = temp;

    return arr;
};

var uglyMoveKey = function (ugly_move) {
    return ugly_move.value;
    // return ugly_move.color + ugly_move.piece + ugly_move.from + ugly_move.to
};

/*The "AI" part starts here */

var minimaxRoot = function(depth, position, isMaximisingPlayer) {

    var newGameMoves = sortMoves(position.getMoves());
    var bestMove = -1000000;
    var bestMoveFound;

    for(var i = 0; i < newGameMoves.length; i++) {
        var newGameMove = newGameMoves[i]

        position.makeMove(newGameMove);
        var value = minimax(depth - 1, position, -1000000, 1000000, !isMaximisingPlayer);
        position.unmakeMove();

        if(value >= bestMove) {
            bestMove = value;
            bestMoveFound = newGameMove;
        }
    }

    return bestMoveFound;
};

cacheHits = 0;
var minimax = function (depth, position, alpha, beta, isMaximisingPlayer) {
    positionCount++;

    if (depth === 0) {
        return -evaluate(position);
    }

    var zobristKey = position.hashKey.high;
    var cachedBoardState = transpositionTableGet(zobristKey);

    if (cachedBoardState && cachedBoardState.depth > depth) {
        cacheHits++;

        if (cachedBoardState.flag == FLAG_EXACT)
            return cachedBoardState.value;

        if (cachedBoardState.flag == FLAG_UPPER)
            beta = Math.min(beta, cachedBoardState.value);

        if (cachedBoardState.flag == FLAG_LOWER)
            alpha = Math.max(alpha, cachedBoardState.value);

        if (alpha > beta)
            return cachedBoardState.value;
    }

    var newGameMoves = sortMoves(position.getMoves());
    var bestMove;
    var bestMoveFound;

    if (isMaximisingPlayer) {
        bestMove = -999999;

        if (cachedBoardState && cachedBoardState.depth <= depth && cachedBoardState.move &&
            (cachedBoardState.flag == FLAG_UPPER || cachedBoardState.flag == FLAG_EXACT)
        ) {
            for (var i = 0; i < newGameMoves.length; i++) {
                if (uglyMoveKey(newGameMoves[i]) == uglyMoveKey(cachedBoardState.move)) {
                    swapMoves(newGameMoves, 0, i);

                    break;
                }
            }
        }

        for (var i = 0; i < newGameMoves.length; i++) {
            if (position.makeMove(newGameMoves[i])) {
                var nextMoveValue = minimax(depth - 1, position, alpha, beta, !isMaximisingPlayer);
                position.unmakeMove();

                if (nextMoveValue > bestMove) {
                    bestMove = nextMoveValue;
                    bestMoveFound = newGameMoves[i];
                }

                alpha = Math.max(alpha, bestMove);

                if (beta <= alpha) {
                    transpositionTablePut(zobristKey, depth, bestMove, bestMoveFound, FLAG_UPPER);
                    return bestMove;
                }
            }
        }
    } else {
        bestMove = 999999;

        if (cachedBoardState && cachedBoardState.depth <= depth && cachedBoardState.move &&
            (cachedBoardState.flag == FLAG_LOWER || cachedBoardState.flag == FLAG_EXACT)
        ) {
            for (var i = 0; i < newGameMoves.length; i++) {
                if (uglyMoveKey(newGameMoves[i]) == uglyMoveKey(cachedBoardState.move)) {
                    swapMoves(newGameMoves, 0, i);

                    break;
                }
            }
        }

        for (var i = 0; i < newGameMoves.length; i++) {
            if(position.makeMove(newGameMoves[i])) {
                var nextMoveValue = minimax(depth - 1, position, alpha, beta, !isMaximisingPlayer);
                position.unmakeMove();

                if (nextMoveValue < bestMove) {
                    bestMove = nextMoveValue;
                    bestMoveFound = newGameMoves[i];
                }

                beta = Math.min(beta, bestMove);

                if (beta <= alpha) {
                    transpositionTablePut(zobristKey, depth, bestMove, bestMoveFound, FLAG_LOWER);
                    return bestMove;
                }
            }
        }
    }

    transpositionTablePut(zobristKey, depth, bestMove, bestMoveFound, FLAG_EXACT);
    return bestMove;
};

/* board visualization and games state handling */

var onDragStart = function (source, piece, position, orientation) {

    /*
    if (position.getStatus()) {
        return false;
    }
    */
};

var makeBestMove = function () {
    cacheHits = 0;

    var bestMove = getBestMove(position);
    position.makeMove(bestMove);

    console.log("Computer found best move", bestMove.getString());

    board.position(positionToObj(position));

    // renderMoveHistory(game.history());

    if (position.getStatus() > 0) {
        alert('Game over');
    }
};


var positionCount;
var getBestMove = function(position) {
    if (position.getStatus() > 0) {
        alert('Game over');
    }

    positionCount = 0;
    var depth = parseInt($('#search-depth').find(':selected').text());

    var d = new Date().getTime();
    var bestMove = minimaxRoot(depth, position, true);
    var d2 = new Date().getTime();
    var moveTime = (d2 - d);
    var positionsPerS = ( positionCount * 1000 / moveTime);

    $('#position-count').text(positionCount);
    $('#time').text(moveTime/1000 + 's');
    $('#positions-per-s').text(positionsPerS);
    $('#cache-hits').text(cacheHits);

    return bestMove;
};

var renderMoveHistory = function (moves) {
    var historyElement = $('#move-history').empty();
    historyElement.empty();
    for (var i = 0; i < moves.length; i = i + 2) {
        historyElement.append('<span>' + moves[i] + ' ' + ( moves[i + 1] ? moves[i + 1] : ' ') + '</span><br>')
    }
    historyElement.scrollTop(historyElement[0].scrollHeight);

};

var onDrop = function (source, target, piece, newPos, oldPos) {
    var nextMove = findMove(source, target, position.getMoves(false, false));

    if (nextMove) {
        position.makeMove(nextMove);
    } else {
        console.log("invalid move!");
        return 'snapback';
    }

    // removeGreySquares();

    //renderMoveHistory(game.history());
    window.setTimeout(makeBestMove, 250);
};

var idxToRowCol = function(index) {
    var colNum = index % 8;
    var rowNum = Math.floor(index / 8);

    return [rowNum, colNum]
};

/**
 * E.g. e1 -> 4
 * @param square
 */
var squareToIdx = function(square) {
    var cols = "abcdefgh";

    var colNum = cols.indexOf(square[0])
    var rowNum = parseInt(square[1]);

    return 8 * (rowNum - 1) + colNum;
};

var positionToObj = function(position) {
    var result = {};

    var cols = "abcdefgh";
    var rows = [1, 2, 3, 4, 5, 6, 7, 8];

    var pieceChars = ['P', 'N', 'B', 'R', 'Q', 'K'];
    colors = ['w', 'b'];

    for (var color = 0; color<colors.length; ++color) {
        for (var piece = Chess.Piece.PAWN; piece <= Chess.Piece.KING; ++piece) {
            var pieces = position.getPieceColorBitboard(piece, color).dup();

            while (!pieces.isEmpty()) {
                var index = pieces.extractLowestBitPosition();

                rowcol = idxToRowCol(index);

                var rowNum = rowcol[0];
                var colNum = rowcol[1];

                posStr = cols[colNum] + rows[rowNum];
                pieceStr = colors[color] + pieceChars[piece];

                result[posStr] = pieceStr;

            }
        }
    }

    return result;
};

var findMove = function(source, target, moves) {
    for (var i=0; i<moves.length; ++i) {
        var move = moves[i];

        boardFrom = squareToIdx(source);
        boardTo = squareToIdx(target);

        if (boardFrom == move.getFrom() && boardTo == move.getTo()) {
            return move
        }
    }
};

var PIECE_VALUES = [100, 300, 300, 500, 900, 20000];

var PIECE_SQUARE_TABLES = [
    // pawn
    [
        0, 0, 0, 0, 0, 0, 0, 0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
        5, 5, 10, 25, 25, 10, 5, 5,
        0, 0, 0, 20, 20, 0, 0, 0,
        5, -5, -10, 0, 0, -10, -5, 5,
        5, 10, 10, -20, -20, 10, 10, 5,
        0, 0, 0, 0, 0, 0, 0, 0
    ],
    // knight
    [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, 0, 0, 0, 0, -20, -40,
        -30, 0, 10, 15, 15, 10, 0, -30,
        -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30,
        -30, 5, 10, 15, 15, 10, 5, -30,
        -40, -20, 0, 5, 5, 0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50
    ],
    // bishop
    [
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 10, 10, 5, 0, -10,
        -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 10, 10, 10, 10, 0, -10,
        -10, 10, 10, 10, 10, 10, 10, -10,
        -10, 5, 0, 0, 0, 0, 5, -10,
        -20, -10, -10, -10, -10, -10, -10, -20
    ],
    // rook
    [
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 10, 10, 10, 10, 10, 10, 5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        0, 0, 0, 5, 5, 0, 0, 0
    ],
    // queen
    [
        -20, -10, -10, -5, -5, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 5, 5, 5, 0, -10,
        -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5,
        -10, 5, 5, 5, 5, 5, 0, -10,
        -10, 0, 5, 0, 0, 0, 0, -10,
        -20, -10, -10, -5, -5, -10, -10, -20
    ],
    // king middle game
    [
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -20, -30, -30, -40, -40, -30, -30, -20,
        -10, -20, -20, -20, -20, -20, -20, -10,
        20, 20, 0, 0, 0, 0, 20, 20,
        20, 30, 10, 0, 0, 10, 30, 20
    ]/*,
     // king end game
     [
     -50, -40, -30, -20, -20, -30, -40, -50,
     -30, -20, -10, 0, 0, -10, -20, -30,
     -30, -10, 20, 30, 30, 20, -10, -30,
     -30, -10, 30, 40, 40, 30, -10, -30,
     -30, -10, 30, 40, 40, 30, -10, -30,
     -30, -10, 20, 30, 30, 20, -10, -30,
     -30, -30, 0, 0, 0, 0, -30, -30,
     -50, -30, -30, -30, -30, -30, -30, -50
     ]*/


];

BISHOP_PAIR_VALUE = PIECE_VALUES[Chess.Piece.PAWN] / 2;

var getPieceSquareValue = function(position, color) {
    var value = 0;
    for (var piece = Chess.Piece.PAWN; piece <= Chess.Piece.KING; ++piece) {
        var pieces = position.getPieceColorBitboard(piece, color).dup();
        while (!pieces.isEmpty()) {
            var index = pieces.extractLowestBitPosition();
            value += PIECE_SQUARE_TABLES[piece][color ? index : (56 ^ index)];
        }
    }
    return value;
};

var onSnapEnd = function () {
    board.position(positionToObj(position));
};

var getMaterialValue = function(position, color) {
    var value = 0;
    for (var piece = Chess.Piece.PAWN; piece < Chess.Piece.KING; ++piece) {
        value += position.getPieceColorBitboard(piece, color).popcnt() * PIECE_VALUES[piece];
    }
    if (position.getPieceColorBitboard(Chess.Piece.BISHOP, color).popcnt() > 1) {
        value += BISHOP_PAIR_VALUE;
    }

    return value;
};

var evaluateMaterial = function(position) {
    return getMaterialValue(position, Chess.PieceColor.WHITE) - getMaterialValue(position, Chess.PieceColor.BLACK);
};

var evaluateLocations = function(chessPosition) {
    return getPieceSquareValue(chessPosition, Chess.PieceColor.WHITE) - getPieceSquareValue(chessPosition, Chess.PieceColor.BLACK);
};

var evaluate = function(chessPosition) {
    return evaluateMaterial(chessPosition) + evaluateLocations(chessPosition);
};

var onMouseoverSquare = function(square, piece) {
    var moves = game.moves({
        square: square,
        verbose: true
    });

    if (moves.length === 0) return;

    greySquare(square);

    for (var i = 0; i < moves.length; i++) {
        greySquare(moves[i].to);
    }
};

var onMouseoutSquare = function(square, piece) {
    removeGreySquares();
};

var removeGreySquares = function() {
    $('#board .square-55d63').css('background', '');
};

var greySquare = function(square) {
    var squareEl = $('#board .square-' + square);

    var background = '#a9a9a9';
    if (squareEl.hasClass('black-3c85d') === true) {
        background = '#696969';
    }

    squareEl.css('background', background);
};



var cfg = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    //onMouseoutSquare: onMouseoutSquare,
    //onMouseoverSquare: onMouseoverSquare,
    onSnapEnd: onSnapEnd
};

var board = ChessBoard('board', cfg);

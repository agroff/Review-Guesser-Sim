// Constants
const STARTING_MONEY = 26000;
// const STARTING_MONEY = 5000;
const CURRENT_GAME_KEY = 'reviewGuesser_currentGame';
const GAME_HISTORY_KEY = 'reviewGuesser_gameHistory';

// Game data structure
function createNewGame() {
  return {
    id: generateGameId(),
    startDateTime: new Date().toISOString(),
    endDateTime: null,
    startingMoney: STARTING_MONEY,
    currentMoney: STARTING_MONEY,
    highestMoney: STARTING_MONEY,
    goodInvestments: 0,
    badInvestments: 0,
    totalInvestments: 0,
  };
}

function generateGameId() {
  return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Storage helpers
async function getCurrentGame() {
  const result = await chrome.storage.local.get(CURRENT_GAME_KEY);
  return result[CURRENT_GAME_KEY] || null;
}

async function saveCurrentGame(gameData) {
  await chrome.storage.local.set({ [CURRENT_GAME_KEY]: gameData });
}

async function getGameHistory() {
  const result = await chrome.storage.local.get(GAME_HISTORY_KEY);
  return result[GAME_HISTORY_KEY] || [];
}

async function saveGameHistory(history) {
  await chrome.storage.local.set({ [GAME_HISTORY_KEY]: history });
}

// Archive current game to history
async function archiveCurrentGame(currentGame) {
  if (!currentGame) return;
  
  // Mark game as completed
  currentGame.endDateTime = new Date().toISOString();
  
  // Add to history
  const history = await getGameHistory();
  history.push(currentGame);
  await saveGameHistory(history);
}

// Message handlers
async function handleGetCurrentGame() {
  let currentGame = await getCurrentGame();
  
  if (!currentGame) {
    // Create new game if none exists
    currentGame = createNewGame();
    await saveCurrentGame(currentGame);
  }
  
  return {
    success: true,
    game: currentGame
  };
}

async function handleTrackInvestment(data) {
  const { investmentCost, returnedIncome } = data;
  
  if (typeof investmentCost !== 'number' || typeof returnedIncome !== 'number') {
    return {
      success: false,
      error: 'Invalid investment data: cost and income must be numbers'
    };
  }
  
  let currentGame = await getCurrentGame();
  
  if (!currentGame) {
    return {
      success: false,
      error: 'No current game found'
    };
  }
  
  // Calculate profit/loss
  const profit = returnedIncome - investmentCost;
  
  // Update game data
  currentGame.currentMoney += profit;
  currentGame.totalInvestments += 1;
  
  // Track highest money achieved
  if (currentGame.currentMoney > currentGame.highestMoney) {
    currentGame.highestMoney = currentGame.currentMoney;
  }
  
  // Track good vs bad investments
  if (profit >= 0) {
    currentGame.goodInvestments += 1;
  } else {
    currentGame.badInvestments += 1;
  }
  
  // Save updated game
  await saveCurrentGame(currentGame);
  
  return {
    success: true,
    game: currentGame,
    investmentResult: {
      cost: investmentCost,
      income: returnedIncome,
      profit: profit
    }
  };
}

async function handleStartNewGame() {
  // Archive current game if it exists
  const currentGame = await getCurrentGame();
  if (currentGame) {
    await archiveCurrentGame(currentGame);
  }
  
  // Create and save new game
  const newGame = createNewGame();
  await saveCurrentGame(newGame);
  
  return {
    success: true,
    game: newGame,
    archivedGame: currentGame
  };
}

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;
  
  switch (type) {
    case 'getCurrentGame':
      handleGetCurrentGame()
        .then(sendResponse)
        .catch(error => sendResponse({
          success: false,
          error: error.message
        }));
      break;
      
    case 'trackInvestment':
      handleTrackInvestment(data)
        .then(sendResponse)
        .catch(error => sendResponse({
          success: false,
          error: error.message
        }));
      break;
      
    case 'startNewGame':
      handleStartNewGame()
        .then(sendResponse)
        .catch(error => sendResponse({
          success: false,
          error: error.message
        }));
      break;

    case 'log':
      console.log(...(data.args || []));
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({
        success: false,
        error: 'Unknown message type'
      });
  }
  
  // Return true to indicate we'll send a response asynchronously
  return true;
});

// Optional: Add context menu or badge updates
chrome.runtime.onInstalled.addListener(() => {
  console.log('Review Guesser Sim background script installed');
});
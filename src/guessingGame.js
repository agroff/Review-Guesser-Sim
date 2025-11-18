(function (root) {
  const ns = (root.ReviewGuesser = root.ReviewGuesser || {});

  const isSteamAppPage = ns.isSteamAppPage;
  const getCurrentSteamAppId = ns.getCurrentSteamAppId;
  const getSteamReviewsContainer = ns.getSteamReviewsContainer;
  const hideAllSteamReviewCounts = ns.hideAllSteamReviewCounts;
  const waitForAnyReviewCount = ns.waitForAnyReviewCount;
  const formatNum = ns.formatNum;
  const formatMoney = ns.formatMoney;

  const reviewsPerSale = 33;

  let currentMoney = 100000000;
  let currentInvestmentAsk = 0;

  function sendMessage(type, data = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, data }, resolve);
    });
  }

  async function log(...args) {
    const response = await sendMessage("log", { args });
    return response;
  }

  // Get current game data
  async function getCurrentGameData() {
    const response = await sendMessage("getCurrentGame");
    return response.success ? response.game : null;
  }

  // Track an investment
  async function trackInvestment(investmentCost, returnedIncome) {
    const response = await sendMessage("trackInvestment", {
      investmentCost,
      returnedIncome,
    });
    return response;
  }

  // Start a new game
  async function startNewGame() {
    const response = await sendMessage("startNewGame");
    return response.success ? response.game : null;
  }

  /**
   * Generates a random number from a normal distribution.
   * @param {number} mean - The center of the bell curve (e.g., 10000).
   * @param {number} stdDev - The standard deviation (spread) of the curve (e.g., 1500).
   * @returns {number} A normally distributed random number.
   */
  function getRandomNormal(mean, stdDev) {
    let u1, u2, z1; // z1 is our standard normal random number

    u1 = 0;
    while (u1 === 0) u1 = Math.random(); // [0, 1) -> (0, 1)
    u2 = Math.random(); // [0, 1)

    // Box-Muller transform
    // This creates two "standard normal" random numbers (mean 0, stdDev 1)
    const z2 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    // Now, we scale and shift the standard normal number (z1)
    // to match the mean and standard deviation we want.
    return z1 * stdDev + mean;
  }

  function ensureLoadingWidget(container, appId) {
    let wrap = container.querySelector(
      `.ext-steam-guess[data-ext-appid="${appId}"]`
    );
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "ext-steam-guess";
      wrap.dataset.extAppid = appId;
      const msg = document.createElement("div");
      msg.className = "ext-wait";
      msg.textContent = "Waiting for review count to load…";
      wrap.appendChild(msg);
      container.prepend(wrap);
    } else {
      const hasButtons = wrap.querySelector("button");
      if (!hasButtons) {
        let msg = wrap.querySelector(".ext-wait");
        if (!msg) {
          msg = document.createElement("div");
          msg.className = "ext-wait";
          wrap.appendChild(msg);
        }
        msg.textContent = "Waiting for review count to load…";
      }
    }
    container.classList.add("ext-mask-reviews");
    return wrap;
  }

  function getExpectedReviewCount(actualReviewCount) {
    // Base review count with a minimum padding
    let reviewCount = actualReviewCount;
    let stdDevPercent = 0.2;
    if (actualReviewCount < 6) {
      reviewCount = actualReviewCount + 3;
      stdDevPercent = 0.4;
    }
    const stdDev = reviewCount * stdDevPercent;
    // To avoid centering too much around the mean, shift up or down by one stdDev randomly
    // with a slight negative bias to make it easier to profit
    const shift = Math.random() < 0.66 ? -stdDev : stdDev;

    const randomCount = getRandomNormal(reviewCount + shift, stdDev);
    return Math.round(randomCount);
  }

  function getRevenue(price, reviewCount) {
    const estimatedSales = reviewCount * reviewsPerSale;
    const revenue = estimatedSales * price;
    return revenue;
  }

  function getReviews(price, revenue) {
    if (price === 0) return 0;
    const estimatedSales = revenue / price;
    const reviewCount = Math.round(estimatedSales / reviewsPerSale);
    return reviewCount;
  }

  function getDeveloperName() {
    const devElem = document.querySelector(".dev_row .summary.column a");
    if (devElem) {
      return devElem.textContent.trim();
    }
    return "Unknown Developer";
  }

  function getPrice() {
    let priceElem = document.querySelector(
      ".game_area_purchase_game_wrapper .game_purchase_price"
    );
    if (!priceElem) {
      priceElem = document.querySelector(
        ".game_purchase_price, .discount_final_price"
      );
    }
    if (priceElem) {
      const priceText = priceElem.textContent.trim();
      if (priceText === "" || /free/i.test(priceText)) {
        return 0;
      }
      return parseFloat(priceText.replace(/[^0-9.-]+/g, ""));
    }
    return 0;
  }

  function roundToNearest(value, step) {
    return Math.round(value / step) * step;
  }
  function getRoundPrice(price) {
    if (price === 0) return "0";
    if (price < 100) return roundToNearest(price, 10);
    if (price < 1000) return roundToNearest(price, 100);
    if (price < 50000) return roundToNearest(price, 1000);
    if (price < 100000) return roundToNearest(price, 5000);
    return roundToNearest(price, 100000);
  }

  async function renderGameTopBar() {
    let currentGame = await getCurrentGameData();
    currentMoney = currentGame.currentMoney;
    const html = `<div class="ext-game-top-bar">
      <div class="ext-top-bar-current-money">
        <div class="current-money-label">
        $${currentMoney.toLocaleString()}
        </div>
      </div>
      <div class="ext-top-bar-highest-money">
        Max Money: $${currentGame.highestMoney.toLocaleString()}
      </div>
      <div class="ext-top-bar-restart">
        <a role="button" class="ext-restart-game-btn">Start New Game</a>
      </div>
    </div>`;
    if (!document.body.querySelector("#ext-top-bar-container")) {
      const div = document.createElement("div");
      div.id = "ext-top-bar-container";
      document.body.insertAdjacentElement("afterbegin", div);
    }
    const container = document.body.querySelector("#ext-top-bar-container");
    container.innerHTML = html;

    if (currentMoney < currentInvestmentAsk) {
      const invQueryDiv = document.querySelector(".ext-invest-query");
      invQueryDiv.innerHTML = `Insufficient funds to invest in this game. <br />
      <a href="javascript:void(0);" class="ext-invest-no">Show Results</a>`;
    }
    const investNoBtn = document.querySelector(".ext-invest-no");
    investNoBtn.addEventListener("click", () => {
      const queryDiv = document.querySelector(".ext-invest-query");
      const resultDiv = document.querySelector("#ext-invest-result");
      const profitDiv = document.querySelector(".ext-profit");
      queryDiv.style.display = "none";
      resultDiv.style.display = "block";
      profitDiv.classList.add("ext-profit-faded");
    });

    const restartBtn = document.querySelector(".ext-restart-game-btn");
    restartBtn.addEventListener("click", async () => {
      const confirmed = confirm(
        "Are you sure you want to start a new game? Your current game progress will be lost."
      );
      if (confirmed) {
        await startNewGame();
        const nextButton = document.querySelector(".ext-next-game");
        if (nextButton) {
          nextButton.click();
        }
      }
    });
  }

  function renderExtLogo() {
    const sibling = document.querySelector("#global_header .content");
    if (!sibling) return;

    let logo = document.createElement("div");
    logo.innerHTML = `Publish Simulator`;
    logo.className = "ext-logo";

    const existingLogo = document.querySelector(".ext-logo");
    if (existingLogo) {
      existingLogo.replaceWith(logo);
    } else {
      sibling.insertAdjacentElement("afterbegin", logo);
    }
  }

  function renderGameUi(wrap, reviewCount) {
    renderGameTopBar();
    renderExtLogo();
    const developer = getDeveloperName();
    const price = getPrice();
    const revenue = getRevenue(price, reviewCount);
    const expectedCount = getExpectedReviewCount(reviewCount);
    const expectedRevenue = getRevenue(price, expectedCount);
    const investment = getRoundPrice(expectedRevenue);
    currentInvestmentAsk = investment;
    const breakEvenReviews = getReviews(price, investment);

    let income = revenue;
    if (revenue > investment) {
      const revShare = (revenue - investment) * 0.5;
      income = investment + revShare;
    }
    const profit = income - investment;
    wrap.innerHTML = `
      <div>
        <strong>${developer}</strong> is asking for an investment of <strong>$${investment}</strong> to publish thier game.<br /><br />
        <table>
          <tr>
          <td>ASK:</td>
          <td>${formatMoney(investment)}</td>
          </tr>
          <tr>
          <td>REV SPLIT:</td>
          <td>50% after costs recovered</td>
          </tr>
          <tr>
          <td>BREAK EVEN:&nbsp;&nbsp;</td>
          <td>~${formatNum(breakEvenReviews)} reviews 
          (${breakEvenReviews * reviewsPerSale} sales @ ${formatMoney(
      price
    )} = ${formatMoney(breakEvenReviews * reviewsPerSale * price)})</td>
          </tr>
        </table>
      </div>
      <div class="ext-invest-query">
        Invest in this game? <br />
        <button type="button" class="ext-invest-yes">Yes</button>
        <button type="button" class="ext-invest-no">No</button>
      </div>
      <div id="ext-invest-result" style="display:none;">
      <div class="ext-invest-result-header">
        RESULTS: ${formatNum(reviewCount)} reviews
      </div>
      <table style="margin:auto;">
        <tr>
          <td>Sales:</td>
          <td>${reviewCount * reviewsPerSale} units @ ${formatMoney(price)}</td>
        </tr>
        <tr>
          <td>Total Revenue:&nbsp;&nbsp;</td>
          <td>${formatMoney(revenue)}</td>
        </tr>
        <tr>
          <td>Income:</td>
          <td>${formatMoney(income)}</td>
        </tr>
      </table>
      
      <div class="ext-profit ${
        profit >= 0 ? "ext-profit-positive" : "ext-profit-negative"
      }">
        PROFIT: ${formatMoney(profit)}
      </div>
      </div>
    `;

    const investYesBtn = wrap.querySelector(".ext-invest-yes");
    const investNoBtn = wrap.querySelector(".ext-invest-no");
    const resultDiv = wrap.querySelector("#ext-invest-result");
    const queryDiv = wrap.querySelector(".ext-invest-query");
    const profitDiv = wrap.querySelector(".ext-profit");
    investYesBtn.addEventListener("click", async () => {
      queryDiv.style.display = "none";
      resultDiv.style.display = "block";
      await trackInvestment(investment, income);
      renderGameTopBar();
    });
    investNoBtn.addEventListener("click", () => {
      queryDiv.style.display = "none";
      resultDiv.style.display = "block";
      profitDiv.classList.add("ext-profit-faded");
    });
  }

  async function injectSteamGuessingGame() {
    if (!isSteamAppPage()) return;

    const appId = getCurrentSteamAppId() || "unknown";

    const existingWrap = document.querySelector(
      `.ext-steam-guess[data-ext-appid="${appId}"]`
    );
    if (existingWrap && existingWrap.dataset.state === "ready") {
      hideAllSteamReviewCounts();
      return;
    }

    document
      .querySelectorAll(".ext-steam-guess[data-ext-appid]")
      .forEach((el) => {
        if (el.getAttribute("data-ext-appid") !== appId) el.remove();
      });

    const container = getSteamReviewsContainer();
    if (!container) {
      return;
    }

    hideAllSteamReviewCounts();

    const wrap = ensureLoadingWidget(container, appId);
    if (!wrap) return;

    if (wrap.dataset.state === "ready") {
      hideAllSteamReviewCounts();
      return;
    }

    let trueCount = wrap.dataset.truecount
      ? parseInt(wrap.dataset.truecount, 10)
      : null;
    if (!Number.isFinite(trueCount)) {
      const got = await waitForAnyReviewCount(5000);
      if (!got) {
        if (!wrap.querySelector(".ext-error")) {
          wrap.innerHTML =
            '<div class="ext-error">Failed to load review count</div>';
        }
        return;
      }
      trueCount = got.count;
      wrap.dataset.truecount = String(trueCount);
    }

    if (wrap.dataset.state !== "ready") {
      renderGameUi(wrap, trueCount);

      wrap.dataset.state = "ready";
    }
  }

  ns.injectSteamGuessingGame = injectSteamGuessingGame;
  ns.sendMessage = sendMessage;
  ns.startNewGame = startNewGame;
  ns.getCurrentGameData = getCurrentGameData;
  ns.log = log;
})(window);

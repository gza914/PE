// ===== FINANCIAL MODELS =====

class Company {
    constructor(name, industry, financials, ceoQuality = 'Mediocre') {
        this.id = Math.random().toString(36).substr(2, 9);
        this.name = name;
        this.industry = industry;
        this.ceoQuality = ceoQuality;

        // Core financials
        this.revenue = financials.revenue;
        this.ebitda = financials.ebitda;
        this.debt = financials.debt;
        this.equityInvested = financials.equityInvested;
        this.interestRate = financials.interestRate || 0.08; // 8% default

        // Growth metrics
        this.baseGrowthRate = financials.baseGrowthRate || 0.05; // 5% quarterly base
        this.currentGrowthRate = this.baseGrowthRate;

        // Historical tracking
        this.history = [];
        this.decisions = [];
        this.quartersSinceAcquisition = 0;

        // Decision effects tracking
        this.costCutEffect = 0;
        this.growthInvestmentEffect = 0;

        // Record initial state
        this.recordHistory();
    }

    get ebitdaMargin() {
        return this.revenue > 0 ? (this.ebitda / this.revenue) : 0;
    }

    get interestExpense() {
        return this.debt * (this.interestRate / 4); // Quarterly interest
    }

    get netIncome() {
        return this.ebitda - this.interestExpense;
    }

    get debtToEBITDA() {
        return this.ebitda > 0 ? (this.debt / (this.ebitda * 4)) : 999; // Annualized EBITDA
    }

    get interestCoverage() {
        return this.interestExpense > 0 ? (this.ebitda / this.interestExpense) : 999;
    }

    get enterpriseValue() {
        // Calculate EV using current market multiple based on growth and margin
        const multiple = this.calculateMarketMultiple();
        return (this.ebitda * 4) * multiple; // Annualized EBITDA * Multiple
    }

    get equityValue() {
        return Math.max(0, this.enterpriseValue - this.debt);
    }

    calculateMarketMultiple() {
        // Base multiple varies by industry
        const industryMultiples = {
            'Software': 12,
            'Manufacturing': 8,
            'Retail': 7,
            'Healthcare': 10
        };

        let baseMultiple = industryMultiples[this.industry] || 8;

        // Adjust for growth (higher growth = higher multiple)
        const growthAdjustment = (this.currentGrowthRate - 0.05) * 20; // +/- 1x per 5% growth difference

        // Adjust for margins
        const marginAdjustment = (this.ebitdaMargin - 0.20) * 10; // +/- 1x per 10% margin difference

        // Adjust for leverage risk
        const leverageAdjustment = Math.max(-3, (5 - this.debtToEBITDA) * 0.5); // Penalty for high leverage

        return Math.max(4, baseMultiple + growthAdjustment + marginAdjustment + leverageAdjustment);
    }

    recordHistory() {
        this.history.push({
            quarter: this.quartersSinceAcquisition,
            revenue: this.revenue,
            ebitda: this.ebitda,
            ebitdaMargin: this.ebitdaMargin,
            debt: this.debt,
            netIncome: this.netIncome,
            debtToEBITDA: this.debtToEBITDA,
            interestCoverage: this.interestCoverage
        });
    }

    makeDecision(action) {
        this.decisions.push({
            quarter: this.quartersSinceAcquisition,
            action: action
        });

        switch(action) {
            case 'cut-costs':
                // Immediate EBITDA margin improvement, slight growth reduction
                this.costCutEffect = 0.03; // +3% margin boost
                this.growthInvestmentEffect = Math.max(-0.02, this.growthInvestmentEffect - 0.01); // -1% growth
                return 'Cost cutting initiated. EBITDA margin will improve by ~3% but growth may slow slightly.';

            case 'invest-growth':
                // Margin sacrifice for growth acceleration
                this.costCutEffect = Math.max(-0.02, this.costCutEffect - 0.015); // -1.5% margin impact
                this.growthInvestmentEffect += 0.03; // +3% growth boost
                return 'Growth investment approved. Revenue growth should accelerate 5-10% but EBITDA margin will compress.';

            case 'do-nothing':
                // Effects decay naturally
                return 'Maintaining current operations. CEO will continue executing existing strategy.';
        }
    }

    simulateQuarter(marketConditions = 1.0) {
        this.quartersSinceAcquisition++;

        // Decay effects over time
        this.costCutEffect *= 0.7; // Effects diminish
        this.growthInvestmentEffect *= 0.8;

        // Calculate revenue growth
        const ceoQualityMultiplier = {
            'Poor': 0.7,
            'Mediocre': 1.0,
            'Excellent': 1.3
        }[this.ceoQuality] || 1.0;

        // Random variance (-2% to +2%)
        const randomVariance = (Math.random() - 0.5) * 0.04;

        this.currentGrowthRate = this.baseGrowthRate +
                                 this.growthInvestmentEffect +
                                 randomVariance;

        const effectiveGrowth = this.currentGrowthRate * marketConditions * ceoQualityMultiplier;
        this.revenue = this.revenue * (1 + effectiveGrowth);

        // Calculate EBITDA with margin effects
        let targetMargin = this.ebitdaMargin + this.costCutEffect;

        // Some random margin variance
        targetMargin += (Math.random() - 0.5) * 0.01;

        // Ensure margins stay reasonable
        targetMargin = Math.max(0.10, Math.min(0.40, targetMargin));

        this.ebitda = this.revenue * targetMargin;

        // Check for covenant violations or financial distress
        const events = [];

        if (this.interestCoverage < 2.0 && this.interestCoverage > 1.5) {
            events.push({
                type: 'warning',
                message: `${this.name}: Interest coverage below 2.0x. Monitor closely.`
            });
        } else if (this.interestCoverage < 1.5) {
            events.push({
                type: 'danger',
                message: `${this.name}: COVENANT VIOLATION! Interest coverage critically low at ${this.interestCoverage.toFixed(2)}x`
            });
        }

        if (this.debtToEBITDA > 6.0) {
            events.push({
                type: 'warning',
                message: `${this.name}: Debt/EBITDA elevated at ${this.debtToEBITDA.toFixed(1)}x. Consider deleveraging.`
            });
        }

        // Random events
        if (Math.random() < 0.1) { // 10% chance per quarter
            const randomEvents = [
                { type: 'good', msg: 'won a major new customer contract', revenueImpact: 1.05 },
                { type: 'good', msg: 'successfully launched new product line', revenueImpact: 1.03 },
                { type: 'bad', msg: 'lost a key customer', revenueImpact: 0.95 },
                { type: 'bad', msg: 'faced unexpected supply chain disruption', marginImpact: 0.97 },
                { type: 'neutral', msg: 'completed operational efficiency initiative', marginImpact: 1.02 }
            ];

            const event = randomEvents[Math.floor(Math.random() * randomEvents.length)];

            if (event.revenueImpact) {
                this.revenue *= event.revenueImpact;
            }
            if (event.marginImpact) {
                this.ebitda *= event.marginImpact;
            }

            events.push({
                type: event.type === 'bad' ? 'warning' : 'info',
                message: `${this.name} ${event.msg}`
            });
        }

        this.recordHistory();
        return events;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            industry: this.industry,
            ceoQuality: this.ceoQuality,
            revenue: this.revenue,
            ebitda: this.ebitda,
            debt: this.debt,
            equityInvested: this.equityInvested,
            interestRate: this.interestRate,
            baseGrowthRate: this.baseGrowthRate,
            currentGrowthRate: this.currentGrowthRate,
            history: this.history,
            decisions: this.decisions,
            quartersSinceAcquisition: this.quartersSinceAcquisition,
            costCutEffect: this.costCutEffect,
            growthInvestmentEffect: this.growthInvestmentEffect
        };
    }

    static fromJSON(data) {
        const company = new Company(data.name, data.industry, {
            revenue: data.revenue,
            ebitda: data.ebitda,
            debt: data.debt,
            equityInvested: data.equityInvested,
            interestRate: data.interestRate,
            baseGrowthRate: data.baseGrowthRate
        }, data.ceoQuality);

        Object.assign(company, data);
        return company;
    }
}

class Fund {
    constructor(size = 100) {
        this.size = size; // In millions
        this.deployedCapital = 0;
        this.portfolio = [];
        this.currentQuarter = 0;
        this.startYear = 2024;
        this.events = [];
        this.maxQuarters = 20; // 5 years
    }

    get dryPowder() {
        return this.size - this.deployedCapital;
    }

    get portfolioValue() {
        return this.portfolio.reduce((sum, company) => sum + company.equityValue, 0);
    }

    get totalValue() {
        return this.dryPowder + this.portfolioValue;
    }

    get moic() {
        // Multiple on Invested Capital
        return this.deployedCapital > 0 ? (this.portfolioValue / this.deployedCapital) : 1;
    }

    calculateIRR() {
        // Simplified IRR calculation
        // Assumes all capital deployed at start, all returns at end
        if (this.currentQuarter === 0 || this.deployedCapital === 0) return 0;

        const years = this.currentQuarter / 4;
        const moic = this.moic;

        // IRR ≈ (MOIC ^ (1/years) - 1)
        return Math.pow(moic, 1 / years) - 1;
    }

    addCompany(company) {
        this.portfolio.push(company);
        this.deployedCapital += company.equityInvested;
    }

    advanceQuarter() {
        this.currentQuarter++;

        // Market conditions vary over time
        const marketConditions = this.getMarketConditions();

        // Simulate all companies
        const allEvents = [];
        this.portfolio.forEach(company => {
            const events = company.simulateQuarter(marketConditions);
            allEvents.push(...events);
        });

        // Add market condition event if significant
        if (marketConditions < 0.95) {
            allEvents.unshift({
                type: 'warning',
                message: 'Market conditions softening. Portfolio growth may slow.'
            });
        } else if (marketConditions > 1.05) {
            allEvents.unshift({
                type: 'info',
                message: 'Strong market tailwinds boosting portfolio performance.'
            });
        }

        return allEvents;
    }

    getMarketConditions() {
        // Simulate market cycles
        const cycle = Math.sin(this.currentQuarter / 8) * 0.1; // 2-year cycle
        const random = (Math.random() - 0.5) * 0.05;
        return 1 + cycle + random;
    }

    getCurrentQuarterLabel() {
        const quarter = (this.currentQuarter % 4) + 1;
        const year = this.startYear + Math.floor(this.currentQuarter / 4);
        return `Q${quarter} ${year}`;
    }

    isGameOver() {
        return this.currentQuarter >= this.maxQuarters;
    }

    toJSON() {
        return {
            size: this.size,
            deployedCapital: this.deployedCapital,
            portfolio: this.portfolio.map(c => c.toJSON()),
            currentQuarter: this.currentQuarter,
            startYear: this.startYear,
            events: this.events,
            maxQuarters: this.maxQuarters
        };
    }

    static fromJSON(data) {
        const fund = new Fund(data.size);
        fund.deployedCapital = data.deployedCapital;
        fund.portfolio = data.portfolio.map(c => Company.fromJSON(c));
        fund.currentQuarter = data.currentQuarter;
        fund.startYear = data.startYear;
        fund.events = data.events;
        fund.maxQuarters = data.maxQuarters;
        return fund;
    }
}

// ===== GAME STATE =====

class Game {
    constructor() {
        this.fund = null;
        this.selectedCompany = null;
        this.pendingDecisions = new Map(); // Track decisions before quarter advance
        this.init();
    }

    init() {
        // Create new fund with starting portfolio
        this.fund = new Fund(100);

        // Add 3 initial portfolio companies
        const companies = [
            new Company('TechServe Solutions', 'Software', {
                revenue: 20,
                ebitda: 6,
                debt: 28,
                equityInvested: 12,
                interestRate: 0.08,
                baseGrowthRate: 0.06
            }, 'Excellent'),

            new Company('Advanced Manufacturing Co', 'Manufacturing', {
                revenue: 40,
                ebitda: 8,
                debt: 35,
                equityInvested: 15,
                interestRate: 0.09,
                baseGrowthRate: 0.04
            }, 'Mediocre'),

            new Company('HealthPlus Clinics', 'Healthcare', {
                revenue: 25,
                ebitda: 5,
                debt: 20,
                equityInvested: 10,
                interestRate: 0.075,
                baseGrowthRate: 0.05
            }, 'Mediocre')
        ];

        companies.forEach(company => {
            this.fund.addCompany(company);
        });

        this.addEvent('Game started. You have 3 portfolio companies and 5 years to generate returns.');
    }

    selectCompany(companyId) {
        this.selectedCompany = this.fund.portfolio.find(c => c.id === companyId);
    }

    makeDecision(companyId, action) {
        const company = this.fund.portfolio.find(c => c.id === companyId);
        if (!company) return;

        const message = company.makeDecision(action);
        this.pendingDecisions.set(companyId, action);

        return message;
    }

    advanceQuarter() {
        const events = this.fund.advanceQuarter();

        // Add all events to event log
        events.forEach(event => {
            this.addEvent(event.message, event.type);
        });

        // Check for game over
        if (this.fund.isGameOver()) {
            this.endGame();
        }

        // Clear pending decisions
        this.pendingDecisions.clear();

        return events;
    }

    addEvent(message, type = 'info') {
        this.fund.events.unshift({ message, type, quarter: this.fund.getCurrentQuarterLabel() });
        if (this.fund.events.length > 50) {
            this.fund.events.pop();
        }
    }

    endGame() {
        const irr = this.fund.calculateIRR();
        const moic = this.fund.moic;

        let performance;
        if (irr > 0.25) {
            performance = 'Outstanding! Top quartile performance.';
        } else if (irr > 0.15) {
            performance = 'Strong performance. LPs will be happy.';
        } else if (irr > 0.08) {
            performance = 'Acceptable returns but below target.';
        } else {
            performance = 'Poor performance. LPs are disappointed.';
        }

        return {
            irr: irr,
            moic: moic,
            portfolioValue: this.fund.portfolioValue,
            deployed: this.fund.deployedCapital,
            performance: performance
        };
    }

    save() {
        const saveData = {
            fund: this.fund.toJSON(),
            selectedCompanyId: this.selectedCompany?.id,
            pendingDecisions: Array.from(this.pendingDecisions.entries())
        };

        localStorage.setItem('pe_simulator_save', JSON.stringify(saveData));
        return true;
    }

    load() {
        const saveData = localStorage.getItem('pe_simulator_save');
        if (!saveData) return false;

        try {
            const data = JSON.parse(saveData);
            this.fund = Fund.fromJSON(data.fund);

            if (data.selectedCompanyId) {
                this.selectedCompany = this.fund.portfolio.find(c => c.id === data.selectedCompanyId);
            }

            this.pendingDecisions = new Map(data.pendingDecisions);
            return true;
        } catch (e) {
            console.error('Failed to load game:', e);
            return false;
        }
    }
}

// ===== UI CONTROLLER =====

class UI {
    constructor(game) {
        this.game = game;
        this.initializeEventListeners();
        this.render();
    }

    initializeEventListeners() {
        // Navigation
        document.getElementById('nextQuarterBtn').addEventListener('click', () => {
            this.handleNextQuarter();
        });

        document.getElementById('closeDetailBtn').addEventListener('click', () => {
            this.showPortfolioView();
        });

        // Game controls
        document.getElementById('saveBtn').addEventListener('click', () => {
            if (this.game.save()) {
                alert('Game saved successfully!');
            }
        });

        document.getElementById('loadBtn').addEventListener('click', () => {
            if (this.game.load()) {
                this.render();
                alert('Game loaded successfully!');
            } else {
                alert('No saved game found.');
            }
        });

        document.getElementById('newGameBtn').addEventListener('click', () => {
            if (confirm('Start a new game? Current progress will be lost.')) {
                this.game.init();
                this.showPortfolioView();
                this.render();
            }
        });

        document.getElementById('newGameFromModal').addEventListener('click', () => {
            this.game.init();
            document.getElementById('gameOverModal').style.display = 'none';
            this.showPortfolioView();
            this.render();
        });
    }

    render() {
        this.renderFundSummary();
        this.renderPortfolio();
        this.renderEvents();

        if (this.game.selectedCompany) {
            this.renderCompanyDetail();
        }
    }

    renderFundSummary() {
        const fund = this.game.fund;

        document.getElementById('fundSize').textContent = `$${fund.size.toFixed(1)}M`;
        document.getElementById('deployedCapital').textContent = `$${fund.deployedCapital.toFixed(1)}M`;
        document.getElementById('dryPowder').textContent = `$${fund.dryPowder.toFixed(1)}M`;
        document.getElementById('portfolioValue').textContent = `$${fund.portfolioValue.toFixed(1)}M`;
        document.getElementById('currentQuarter').textContent = fund.getCurrentQuarterLabel();

        const irr = fund.calculateIRR();
        const irrText = fund.currentQuarter > 0 ? `${(irr * 100).toFixed(1)}%` : 'N/A';
        document.getElementById('currentIRR').textContent = irrText;
    }

    renderPortfolio() {
        const container = document.getElementById('portfolioList');
        container.innerHTML = '';

        this.game.fund.portfolio.forEach(company => {
            const card = this.createCompanyCard(company);
            container.appendChild(card);
        });
    }

    createCompanyCard(company) {
        const card = document.createElement('div');
        card.className = 'company-card';
        card.onclick = () => {
            this.game.selectCompany(company.id);
            this.showCompanyDetail();
        };

        const debtColor = company.debtToEBITDA < 4 ? 'metric-good' :
                         company.debtToEBITDA < 6 ? 'metric-warning' : 'metric-danger';

        const coverageColor = company.interestCoverage > 3 ? 'metric-good' :
                             company.interestCoverage > 2 ? 'metric-warning' : 'metric-danger';

        card.innerHTML = `
            <div class="company-card-header">
                <div class="company-name">${company.name}</div>
                <div class="company-industry">${company.industry}</div>
            </div>
            <div class="company-metrics">
                <div class="company-metric">
                    <label>Revenue</label>
                    <span>$${company.revenue.toFixed(1)}M</span>
                </div>
                <div class="company-metric">
                    <label>EBITDA</label>
                    <span>$${company.ebitda.toFixed(1)}M</span>
                </div>
                <div class="company-metric">
                    <label>Debt/EBITDA</label>
                    <span class="${debtColor}">${company.debtToEBITDA.toFixed(1)}x</span>
                </div>
                <div class="company-metric">
                    <label>Int. Coverage</label>
                    <span class="${coverageColor}">${company.interestCoverage.toFixed(1)}x</span>
                </div>
                <div class="company-metric">
                    <label>Equity Value</label>
                    <span>$${company.equityValue.toFixed(1)}M</span>
                </div>
                <div class="company-metric">
                    <label>MOIC</label>
                    <span class="${company.equityValue > company.equityInvested ? 'metric-good' : 'metric-warning'}">
                        ${(company.equityValue / company.equityInvested).toFixed(2)}x
                    </span>
                </div>
            </div>
        `;

        return card;
    }

    renderCompanyDetail() {
        const company = this.game.selectedCompany;
        if (!company) return;

        document.getElementById('detailCompanyName').textContent = company.name;

        // Financials
        document.getElementById('detailRevenue').textContent = `$${company.revenue.toFixed(1)}M`;
        document.getElementById('detailEBITDA').textContent = `$${company.ebitda.toFixed(1)}M`;
        document.getElementById('detailEBITDAMargin').textContent = `${(company.ebitdaMargin * 100).toFixed(1)}%`;
        document.getElementById('detailDebt').textContent = `$${company.debt.toFixed(1)}M`;
        document.getElementById('detailInterest').textContent = `$${company.interestExpense.toFixed(1)}M`;
        document.getElementById('detailNetIncome').textContent = `$${company.netIncome.toFixed(1)}M`;
        document.getElementById('detailEquity').textContent = `$${company.equityInvested.toFixed(1)}M`;
        document.getElementById('detailEV').textContent = `$${company.enterpriseValue.toFixed(1)}M`;

        // Metrics
        const debtColor = company.debtToEBITDA < 4 ? 'metric-good' :
                         company.debtToEBITDA < 6 ? 'metric-warning' : 'metric-danger';
        document.getElementById('detailDebtEBITDA').innerHTML =
            `<span class="${debtColor}">${company.debtToEBITDA.toFixed(2)}x</span>`;

        const coverageColor = company.interestCoverage > 3 ? 'metric-good' :
                             company.interestCoverage > 2 ? 'metric-warning' : 'metric-danger';
        document.getElementById('detailInterestCoverage').innerHTML =
            `<span class="${coverageColor}">${company.interestCoverage.toFixed(2)}x</span>`;

        const growthPercent = company.currentGrowthRate * 100 * 4; // Annualized
        const growthColor = growthPercent > 15 ? 'metric-good' :
                           growthPercent > 5 ? '' : 'metric-warning';
        document.getElementById('detailGrowth').innerHTML =
            `<span class="${growthColor}">${growthPercent.toFixed(1)}%</span>`;

        document.getElementById('detailCEO').textContent = company.ceoQuality;

        // Decision buttons
        const decisionButtons = document.querySelectorAll('.decision-btn');
        decisionButtons.forEach(btn => {
            btn.classList.remove('selected');
            btn.onclick = () => {
                decisionButtons.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');

                const action = btn.dataset.action;
                const feedback = this.game.makeDecision(company.id, action);

                const feedbackEl = document.getElementById('decisionFeedback');
                feedbackEl.textContent = feedback;
                feedbackEl.classList.add('show');
            };

            // Show if already selected
            const pendingAction = this.game.pendingDecisions.get(company.id);
            if (pendingAction === btn.dataset.action) {
                btn.classList.add('selected');
            }
        });

        // Performance history
        this.renderPerformanceHistory(company);
    }

    renderPerformanceHistory(company) {
        const container = document.getElementById('performanceHistory');
        container.innerHTML = '';

        // Show last 8 quarters
        const recentHistory = company.history.slice(-8).reverse();

        recentHistory.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <strong>Quarter ${entry.quarter}:</strong>
                Revenue: $${entry.revenue.toFixed(1)}M |
                EBITDA: $${entry.ebitda.toFixed(1)}M (${(entry.ebitdaMargin * 100).toFixed(1)}%) |
                Debt/EBITDA: ${entry.debtToEBITDA.toFixed(2)}x
            `;
            container.appendChild(item);
        });
    }

    renderEvents() {
        const container = document.getElementById('eventsList');
        container.innerHTML = '';

        this.game.fund.events.slice(0, 10).forEach(event => {
            const item = document.createElement('div');
            item.className = `event-item ${event.type || ''}`;
            item.innerHTML = `<strong>${event.quarter || 'Start'}:</strong> ${event.message}`;
            container.appendChild(item);
        });
    }

    showCompanyDetail() {
        document.querySelector('.portfolio-panel').style.display = 'none';
        document.getElementById('companyDetail').style.display = 'block';
        this.renderCompanyDetail();
    }

    showPortfolioView() {
        document.getElementById('companyDetail').style.display = 'none';
        document.querySelector('.portfolio-panel').style.display = 'block';
        this.game.selectedCompany = null;
    }

    handleNextQuarter() {
        // Check if all companies have decisions
        const companiesWithoutDecisions = this.game.fund.portfolio.filter(
            company => !this.game.pendingDecisions.has(company.id)
        );

        if (companiesWithoutDecisions.length > 0) {
            // Auto-assign "do-nothing" to companies without decisions
            companiesWithoutDecisions.forEach(company => {
                this.game.makeDecision(company.id, 'do-nothing');
            });
        }

        // Advance quarter
        this.game.advanceQuarter();

        // Clear decision feedback
        const feedbackEl = document.getElementById('decisionFeedback');
        feedbackEl.classList.remove('show');

        // Re-render everything
        this.render();

        // Check for game over
        if (this.game.fund.isGameOver()) {
            this.showGameOver();
        }

        // Show message
        this.game.addEvent(`Advanced to ${this.game.fund.getCurrentQuarterLabel()}`);
    }

    showGameOver() {
        const results = this.game.endGame();

        const modal = document.getElementById('gameOverModal');
        const statsDiv = document.getElementById('gameOverStats');

        statsDiv.innerHTML = `
            <div class="stat">
                <label>Final Portfolio Value</label>
                <span>$${results.portfolioValue.toFixed(1)}M</span>
            </div>
            <div class="stat">
                <label>Capital Deployed</label>
                <span>$${results.deployed.toFixed(1)}M</span>
            </div>
            <div class="stat">
                <label>MOIC (Multiple on Invested Capital)</label>
                <span class="${results.moic > 2 ? 'metric-good' : results.moic > 1.5 ? 'metric-warning' : 'metric-danger'}">
                    ${results.moic.toFixed(2)}x
                </span>
            </div>
            <div class="stat">
                <label>IRR (Internal Rate of Return)</label>
                <span class="${results.irr > 0.2 ? 'metric-good' : results.irr > 0.1 ? 'metric-warning' : 'metric-danger'}">
                    ${(results.irr * 100).toFixed(1)}%
                </span>
            </div>
            <div class="stat">
                <label>Performance Rating</label>
                <span>${results.performance}</span>
            </div>
        `;

        modal.style.display = 'flex';
    }
}

// ===== INITIALIZE GAME =====

let game;
let ui;

game = new Game();
ui = new UI(game);

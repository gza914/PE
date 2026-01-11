# PE Simulator - Private Equity Fund Management Game

A realistic private equity simulation game where you manage a $100M fund, make strategic decisions about portfolio companies, and aim for strong returns through leveraged buyouts and operational improvements.

## 🎮 Quick Start

1. Open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge)
2. No installation or build process required - runs entirely in the browser
3. Game state automatically saves to browser localStorage

## 🎯 Game Objective

Manage a private equity fund over 20 quarters (5 years) to maximize returns for your Limited Partners (LPs). Your goal is to achieve:
- **Target IRR:** 20%+ (Internal Rate of Return)
- **Target MOIC:** 2.5x+ (Multiple on Invested Capital)

## 📊 Starting Position

You begin with:
- **Fund Size:** $100M in equity capital
- **Portfolio:** 3 companies already acquired
  - TechServe Solutions (Software) - High growth, excellent CEO
  - Advanced Manufacturing Co (Manufacturing) - Stable, mediocre CEO
  - HealthPlus Clinics (Healthcare) - Moderate growth, mediocre CEO

## 🎲 Gameplay Loop

### Each Quarter You Will:

1. **Review Portfolio Performance**
   - Check revenue growth, EBITDA margins, and debt metrics
   - Monitor key ratios: Debt/EBITDA and Interest Coverage
   - Review financial history and trends

2. **Make Strategic Decisions** for each company:
   - **Cut Costs:** Improve EBITDA margins by 2-4% but may slow growth
   - **Invest in Growth:** Boost revenue growth by 5-10% but compress margins
   - **Maintain Course:** Let the CEO execute, no major changes

3. **Advance Quarter**
   - Companies operate based on your decisions
   - Random market events may occur (new customers, supply chain issues, etc.)
   - Debt service is paid from EBITDA
   - Financial metrics update

4. **Monitor Risk**
   - Watch for covenant violations (Interest Coverage < 2.0x)
   - High leverage (Debt/EBITDA > 6x) increases bankruptcy risk
   - Poor decisions compound over time

## 📈 Key Financial Metrics

### Company-Level Metrics

- **Revenue:** Total sales per quarter (in millions)
- **EBITDA:** Earnings Before Interest, Taxes, Depreciation, Amortization
  - This is your "operating profit" - what the business generates before debt service
- **EBITDA Margin:** EBITDA ÷ Revenue (higher is better, 20%+ is strong)
- **Debt/EBITDA:** Total Debt ÷ (Annual EBITDA)
  - < 4x = Safe leverage
  - 4-6x = Moderate risk
  - \> 6x = High risk
- **Interest Coverage:** EBITDA ÷ Interest Expense
  - \> 3x = Healthy
  - 2-3x = Monitor closely
  - < 2x = Covenant violation risk
- **Enterprise Value:** EBITDA × Market Multiple
  - Multiple depends on growth rate, margins, industry, and leverage
- **Equity Value:** Enterprise Value - Debt (what your investment is worth)

### Fund-Level Metrics

- **Deployed Capital:** Total equity invested across all companies
- **Dry Powder:** Remaining uninvested capital
- **Portfolio Value:** Sum of all equity values
- **MOIC:** Portfolio Value ÷ Deployed Capital
- **IRR:** Annualized return rate (accounts for time value of money)

## 🎯 Strategic Considerations

### Leverage Dynamics
- **More debt = Higher returns** if the company performs well
- **More debt = Higher risk** of bankruptcy if performance falters
- Interest expense reduces cash available for growth
- Typical LBO structure: 60-70% debt, 30-40% equity

### CEO Quality Matters
- **Excellent CEOs** execute better and drive 30% higher growth
- **Mediocre CEOs** deliver baseline performance
- **Poor CEOs** underperform by 30%

### Growth vs. Profitability Trade-off
- Growth investments increase revenue but compress EBITDA margins short-term
- Cost cutting boosts EBITDA immediately but may slow long-term growth
- Balance is key - high-growth companies command higher exit multiples

### Market Conditions
- Market cycles affect all portfolio companies
- Strong markets boost growth and exit multiples
- Weak markets reduce growth and compress valuations
- You cannot control macro conditions

### Exit Multiples
Valuation multiples vary by:
- **Industry:** Software (12x) > Healthcare (10x) > Manufacturing (8x) > Retail (7x)
- **Growth Rate:** Higher growth = higher multiple
- **Margins:** Better margins = higher multiple
- **Leverage:** High debt = lower multiple (increased risk)

## 🎓 Learning Through Play

This game teaches real PE concepts:

1. **Leveraged Buyouts:** Using debt to amplify equity returns
2. **Operational Value Creation:** Improving EBITDA through cost cuts and growth initiatives
3. **Financial Risk Management:** Balancing leverage with debt service capacity
4. **Portfolio Strategy:** Managing multiple companies with limited attention
5. **Exit Timing:** Selling when companies have grown and markets are strong

## 💾 Save/Load System

- **Auto-Save:** Game state persists in browser localStorage
- **Save Button:** Manually save current progress
- **Load Button:** Restore last saved game
- **New Game:** Start fresh (clears current progress)

## 🎮 Tips for Success

1. **Monitor Debt Ratios:** Never let Interest Coverage fall below 2.0x
2. **Diversify Decisions:** Not all companies need aggressive growth investments
3. **CEO Quality:** Excellent CEOs can handle "Maintain Course" - bad CEOs need active management
4. **Timing Matters:** Cost cutting early can create dry powder for growth later
5. **Market Multiples:** High-growth companies exit at premium valuations
6. **Track History:** Review quarterly performance to spot trends

## 🏆 Performance Benchmarks

| IRR | MOIC | Rating |
|-----|------|--------|
| 25%+ | 3.0x+ | Outstanding - Top Quartile |
| 20-25% | 2.5-3.0x | Excellent - Strong Performance |
| 15-20% | 2.0-2.5x | Good - Above Target |
| 10-15% | 1.5-2.0x | Acceptable - Below Target |
| <10% | <1.5x | Poor - LPs Disappointed |

## 🔧 Technical Details

- **Frontend Only:** Pure HTML/CSS/JavaScript
- **No Backend Required:** All logic runs client-side
- **Data Persistence:** Browser localStorage
- **Compatible:** All modern browsers
- **Responsive Design:** Works on desktop and tablet

## 🚀 Future Enhancements (Not Yet Implemented)

The prototype focuses on core mechanics. Future versions could add:
- Deal sourcing pipeline (new acquisition opportunities)
- Active "hands-on" CEO mode with deeper operational decisions
- Hiring/firing CEOs
- Add-on acquisitions (bolt-ons)
- Refinancing debt
- Multiple funds and fundraising
- Competitor actions
- More diverse industries and company archetypes
- Detailed P&L and balance sheet views
- Charts and visualizations

## 📝 Game Design Philosophy

This simulation prioritizes:
1. **Realistic Financials:** All numbers interconnect logically
2. **Strategic Trade-offs:** No "right answer" - every choice has pros and cons
3. **Learning by Doing:** Mechanics teach real PE concepts through gameplay
4. **Emergent Strategy:** Players develop investing philosophies through experience

## 🐛 Known Limitations

- Simplified IRR calculation (assumes even capital deployment)
- No mid-quarter transactions (refinancing, add-ons, etc.)
- CEO quality is fixed (no hiring/firing)
- Limited random events
- No competitive dynamics (other PE firms)

## 📄 License

Open source - feel free to modify and extend!

---

**Enjoy building your PE empire! Can you turn $100M into $300M+ in 5 years?**

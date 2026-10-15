# XBT Accumulation Bot

Standalone StartOS service that accumulates XBT (Bitcoin BLAKE2b) with BTC on Neoxa Exchange.

- Buy rule: up to three price tiers; each unlocks a share of the budget once the best ask is at or below its price.
- Execution: one post-only (maker) limit order of a fixed XBT size at a time; the next is placed only after the previous one fills.
- Funds: you deposit BTC and withdraw XBT yourself (Neoxa's API has no deposit/withdraw endpoints).
- Safe by default: disabled, dry-run mode, zero budget.

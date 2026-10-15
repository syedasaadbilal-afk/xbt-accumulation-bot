# XBT Accumulation Bot

Buys XBT (Bitcoin BLAKE2b, ledger symbol BTCB2) with BTC on Neoxa Exchange in price tiers, one small limit order at a time.

## Setup

1. In Neoxa Exchange, create an API key with **Read** and **Trade** only, and put this service's outbound IP on the key's IP allow list.
2. Open the dashboard and paste the API key and secret under "Neoxa API key".
3. Deposit a small BTC float on Neoxa by hand (the API cannot deposit or withdraw).
4. Set the budget, order size and price tiers, tick "Bot enabled", and leave "Live trading" off first to see what it would place. Turn Live trading on when satisfied.

## Notes

The bot only places and cancels buy orders. You withdraw XBT yourself on the website. Experimental software; never risk more than you can afford to lose.

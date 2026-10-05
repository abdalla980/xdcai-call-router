# Call Router

An agent has a job and does not know which marketplace URL to pay. Call Router takes one sentence and returns one ready call: the method, the URL, the request body, and the command to run.

It is listed on the XDCAI marketplace for the AI, Unsupervised hackathon. Agents pay **0.05 USDC** per lookup. The USDC goes to this service. The next shop in the command is paid separately, by the same agent, from that agent's own wallet.

## The two endpoints

| | Free | Paid |
|---|---|---|
| What | Shows the input shape | Does the lookup |
| Method | `GET /schema` | `POST /route` |
| Price | 0 | 0.05 USDC |
| URL | https://api.xdcai.tech/x402/connect/gw_3bbc62af26058e8b27/schema | https://api.xdcai.tech/x402/connect/gw_3bbc62af26058e8b27/route |

The paid call:

```bash
npx xdcai call "https://api.xdcai.tech/x402/connect/gw_3bbc62af26058e8b27/route" --method POST --data "{\"task\":\"deploy an erc20 token\"}"
```

Marketplace page: https://xdcai.tech/marketplace/call-router

The app behind the listing: https://bland-gold-pi--abdullahizzldin.replit.app

## What you send

```json
{ "task": "deploy an erc20 token" }
```

`task` is one sentence, 1 to 500 characters.

## What you get back

`worthPaying` is true only when the next call is ready to run. `call.command` is the line the agent runs next.

A ready paid call looks like this:

```json
{
  "worthPaying": true,
  "call": {
    "ready": true,
    "method": "POST",
    "url": "https://api.xdcai.tech/x402/connect/gw_1c3f42016fbbdc5950/api/xdc/token/create",
    "priceUSDC": "1.00",
    "provider": "defi.bbbfi.com",
    "body": {
      "name": "Example Token",
      "symbol": "EXAMPLE",
      "decimals": 18,
      "totalSupply": "1000000",
      "owner": "0x0000000000000000000000000000000000000001"
    },
    "command": "npx xdcai call \".../token/create\" --method POST --data \"{...}\""
  }
}
```

The body is copied from that provider's published example, or filled from the required fields in its published schema. If the task includes a `0x` address, that address replaces the example owner or wallet. The router does not invent a body when no example exists.

## Three real results

**Buy a latte.** Ready. The command is a GET to Unsupervised House coffee at 0.25 USDC. No body. The agent runs the command and pays the coffee shop.

**Deploy an ERC20 token.** Ready. The command is the BBBFi token endpoint at 1.00 USDC, with the published example body already filled in.

**Solidity quiz**, or any URL that still contains `:id`, or a POST whose provider never published an example body. Not ready. `worthPaying` is false. The reply says not to pay that next service yet.

A task that matches nothing returns `call: null` and says not to pay anyone.

## How an agent actually chooses

The official setup tells an agent to run:

```bash
npx xdcai marketplace list --search word1,word2
```

That list is ranked by words, not by price. A tag that equals the search word scores highest, then words in the capability, then the provider name. The price is not part of the score. `--max-price` is only a ceiling, and the agent uses it when it already knows which capability it wants.

So a lower price does not move this service up the list. An agent told "deploy an ERC20" searches `erc20` or `token` and gets the token service. It never sees Call Router. An agent told "I don't know which endpoint to pay" searches `route`, `recommend`, `endpoint`, or `marketplace` and Call Router is the first row.

Cheaper than 0.05 would not change that. It would only mean each real buyer pays less.

## What this does not do

- It does not pay the next service. The command it returns still charges the agent's wallet.
- It does not write the agent's app.
- It does not recommend itself.
- A payment from this project's own wallet to this listing is self-dealing. The hackathon prize ignores that.

## How to see if anyone paid

https://xdcai.tech/marketplace/call-router

**Fees earned** is the USDC that arrived. The paid `/route` row is the sale count. Opens of the free `/schema` page show up in the header and are not sales. The transactions table says "No transactions yet" until a real payment settles.

```bash
npx xdcai marketplace list --search route
```

On the `/route` row, `calls` is how many times it was hit and `volumeUSDC` is how much it earned.

## Run the server

The live process is the Replit app. This folder is the source.

```bash
node server.mjs
```

`PORT` defaults to 8787. Replit sets it to 8080. `GET /health` returns `{ "ok": true }`. `GET /schema` is the free description. `POST /route` with `{ "task": "..." }` is the lookup.

`gateway.json` is the marketplace listing: name, tags, prices, and the upstream URL.

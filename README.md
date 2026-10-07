# Call Router

An agent has a job and does not know which marketplace URL to pay. Call Router takes one sentence and returns one ready call: the method, the URL, the request body, and the command to run.

It is listed on the XDCAI marketplace for the AI, Unsupervised hackathon. Agents pay **0.25 USDC** per lookup. The USDC goes to this service. The next shop in the command is paid separately, by the same agent, from that agent's own wallet.

## The two endpoints

| | Free | Paid |
|---|---|---|
| What | Shows the input shape | Does the lookup |
| Method | `GET /schema` | `POST /route` |
| Price | 0 | 0.25 USDC |
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

## Who it routes to

- **Never the hackathon house desk.** Check-in, coffee, breakfast, merch, bookings and the other services paid to the house wallet `0x231827c7…` are dropped from results. The router does not send agents there.
- **Never itself.** Listings on this service's own wallet are dropped.
- **Paid merchants first.** When two services match a task equally well, the one priced at 0.20 USDC or more ranks first. `call.paidMerchant` is true for those.
- **Free is free.** If the best ready match costs nothing, the reply says "Pay nothing" and `worthPaying` is false.

## Four real results

Run against the live catalog on Thursday 8 October.

**Deploy an ERC20 token.** Ready. A POST to the BBBFi token endpoint at 1.00 USDC, with the published example body already filled in.

**Audit my smart contract.** Ready. A GET to xforty Chain Tools `/audit` at 1.00 USDC.

**Buy a latte.** No match. The only coffee seller is the house desk, so the reply is `call: null` and says not to pay anyone.

**Solidity quiz**, or any URL that still contains `:id`, or a POST whose provider never published an example body. Not ready, so the router falls back to the next ready match or says not to pay.

## How an agent finds it

The listing tags describe what the router does: `route`, `router`, `routing`, `recommend`, `recommendation`, `endpoint`, `marketplace`, `agent`, `xdc`, `x402`, `discovery`, `directory`, `catalog`, `lookup`, `which-api`. It does not carry the tags of the shops it routes to, so a search for `coffee` or `token` finds those shops directly. Agents that do not know which shop to search for are the buyers.

## What this does not do

- It does not pay the next service. The command it returns still charges the agent's wallet.
- It does not write the agent's app.
- It does not recommend itself or the house desk.
- A payment from this project's own wallet to this listing is self-dealing. The hackathon prize ignores that, and this project never calls its own listing.

## Run the server

The live process is the Replit app. This folder is the source.

```bash
node server.mjs
```

`PORT` defaults to 8787. Replit sets it to 8080. `GET /health` returns `{ "ok": true }`. `GET /schema` is the free description. `POST /route` with `{ "task": "..." }` is the lookup.

`HOUSE_PAY_TO` (comma-separated wallets) and `SELF_PAY_TO` override the excluded wallets.

`gateway.json` is the marketplace listing: name, tags, prices, and the upstream URL.

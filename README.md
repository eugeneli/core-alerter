![banner](https://i.imgur.com/6QZcUTc.jpg)
# Core Event Alerter

## Introduction
Core-Alerter keeps watch of delegate events like missed blocks, ranking changes, and forging status updates. Any changes to the list of watched delegates will automatically ping the user on Discord.

### Installation
Installation is quick an easy, just follow these 2 simple steps:

1. `solar plugin:install https://github.com/eugeneli/core-alerter.git`
2. Copy the `Sample Config` below into `.config/solar-core/{mainnet/testnet}/app.json` under `core` or `relay` depending on which you're using

![img](https://i.imgur.com/d1GbJDz.jpg)

## How do I get the Discord ID?
Right click the user account you want to ping (it can even be your own) and click `Copy ID`

![Copy ID](https://i.imgur.com/GtVxQNe.jpg)

## Sample Config: 
```
{
    "package": "@eugeneli/core-alerter",
    "options": {
        "enabled": true,
        "forgingThreshold": 53,
        "delegates": [
            {
                name: "delegate_name",
                discordId: "111222333444555667"
            }
        ],
        "discord": {
            "webhook": "https://discord.com/api/webhooks/..."
        }
    }
}
```
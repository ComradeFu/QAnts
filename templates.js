const path = require("path")
const Template = require("./template")

const templates = module.exports = {}

const config = require("./config")

const items = new Map()

let loader = null

templates.run = function ()
{
    if (config.loader == "")
    {
        loader = require("./loader")
        return
    }

    const whole = path.resolve(config.search, config.loader)

    loader = require(whole)
}

templates.items = function ()
{
    return items
}

templates.load = function (name)
{
    let template = items.get(name)
    if (template != null)
    {
        return template
    }

    if (name == "")
    {
        return
    }

    template = new Template(name)

    const whole = path.resolve(config.search, name)
    const on_open = loader(name, whole)

    items.set(name, template)

    on_open(template)

    return template
}

templates.get_loader = function ()
{
    return loader
}
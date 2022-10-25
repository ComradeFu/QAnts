const ants = require("./head")
const config = require("./config")
const main = require("./main")

/**
 * 配置一些基础
 * config = {
 *  loader : ""
 *  boot : ""
 * }
 */
ants.config = function (cf)
{
    Object.assign(config, cf)

    config.cluster = config.cluster || 1
}

ants.run = function ()
{
    main.run()
}

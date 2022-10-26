const ants = require("./head")
const config = require("./config")
const main = require("./main")
const logconsumerbase = require("./logconsumerbase")

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

//导出的基类
ants.LogConsumerBase = logconsumerbase

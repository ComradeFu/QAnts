/**
 * 标准输出
 */
let colors = require('colors/safe')
const console = global.console

const LogConsumerBase = require("./logconsumerbase")
// -----------------------------------------------------------------------------
module.exports = class LogConsumerStd extends LogConsumerBase
{
    get_tp()
    {
        return "std"
    }

    info(logger, ...args)
    {
        let log_str = this.get_log_str(logger, ...args)
        console.log(log_str)
    }

    debug(logger, ...args)
    {
        let log_str = this.get_log_str(logger, ...args)
        console.log(log_str)
    }

    warn(logger, ...args)
    {
        let log_str = this.get_log_str(logger, ...args)
        console.warn(log_str)
    }

    error(logger, ...args)
    {
        let log_str = this.get_log_str(logger, ...args)
        console.error(log_str)
    }

    fatal(logger, ...args)
    {
        let log_str = this.get_log_str(logger, ...args)
        console.error(log_str)
    }
}

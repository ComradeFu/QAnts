/**
 * 输出基类
 */
const LogFormatDefault = require("./logformatdefault")
// -----------------------------------------------------------------------------
module.exports = class DefaultLogConsumer
{
    get_tp()
    {
        assert(false, `需要自己实现 get tp.`)
    }

    get_log_str(logger, ...args)
    {
        if (logger.format)
            return logger.format(logger, this, ...args)

        return LogFormatDefault(logger, this, ...args)
    }

    info(logger, ...args)
    {

    }

    debug(logger, ...args)
    {

    }

    warn(logger, ...args)
    {

    }

    error(logger, ...args)
    {

    }

    fatal(logger, ...args)
    {

    }
}

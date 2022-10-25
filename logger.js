let levels = {
    all: 0,
    debug: 1,
    info: 2,        //2
    warn: 3,
    error: 4,          //4
    fatal: 5,
    off: 6,            //6
}
// -----------------------------------------------------------------------------
module.exports = class DefaultLogger
{
    constructor()
    {
        //集合
        this.loggers = {}

        //日志消耗
        this.logconsumers = []

        //自己用的logger
        this.logger = this.logs("logger")

        //日志等级
        this.curr_level = 0
    }

    add_consumer(logconsumer)
    {
        this.logconsumers.push(logconsumer)
    }

    del_consumer(logconsumer)
    {
        let logconsumers = this.logconsumers
        for (let index = 0; index < logconsumers.length; ++index)
        {
            let one = logconsumers[index]
            if (one === logconsumer)
            {
                logconsumers.splice(index, 1)
            }
        }
    }

    //开启/关闭对应的 logger
    enable(logger_name, enabled)
    {
        let logger = this.logs(logger_name)
        logger.enable = enabled
    }

    //设置日志等级
    set_level(level)
    {
        this.curr_level = level
    }

    catch(func)
    {
        return function wrap(...args)
        {
            try
            {
                func(...args)
            }
            catch (e)
            {
                global.console.error(e)
            }
        }
    }

    //logs逻辑
    logs(name)
    {
        let that = this

        //create new logger
        let exists = { name, tags: {} }

        exists.enabled = true
        exists.debug = this.catch(function (...args)
        {
            if (!exists.enabled || levels.debug < that.curr_level)
            {
                return
            }

            for (let one of that.logconsumers)
            {
                try
                {
                    one.debug(exists, ...args)
                }
                catch (e)
                {
                    global.console.error(e)
                }
            }
        })

        exists.info = this.catch(function (...args)
        {
            if (!exists.enabled || levels.info < that.curr_level)
            {
                return
            }

            for (let one of that.logconsumers)
            {
                try
                {
                    one.info(exists, ...args)
                }
                catch (e)
                {
                    global.console.error(e)
                }
            }
        })
        exists.warn = this.catch(function (...args)
        {
            if (!exists.enabled || levels.warn < that.curr_level)
            {
                return
            }

            for (let one of that.logconsumers)
            {
                try
                {
                    one.warn(exists, ...args)
                }
                catch (e)
                {
                    global.console.error(e)
                }
            }
        })
        exists.error = this.catch(function (...args)
        {
            if (!exists.enabled || levels.error < that.curr_level)
            {
                return
            }

            for (let one of that.logconsumers)
            {
                try
                {
                    one.error(exists, ...args)
                }
                catch (e)
                {
                    global.console.error(e)
                }
            }
        })
        exists.fatal = this.catch(function (...args)
        {
            if (!exists.enabled || levels.fatal < that.curr_level)
            {
                return
            }

            for (let one of that.logconsumers)
            {
                try
                {
                    one.fatal(exists, ...args)
                }
                catch (e)
                {
                    global.console.error(e)
                }
            }
        })
        return exists
    }

    //先不cache
    del_log(name)
    {
        // global.console.log(`delete logger :${name}`)
        let loggers = this.loggers

        let exists = loggers[name]
        if (!exists)
        {
            // global.console.error(`no this logger:${name}`)
            return
        }

        delete loggers[name]
    }
}

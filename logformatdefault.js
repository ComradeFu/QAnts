/**
 * 默认的日志格式化
 */
const now_ms = global.now_ms
module.exports = function (logger, consumer, ...args)
{
    let now = now_ms()
    if (args[0] instanceof Error)
    {
        let err = args[0]
        let err_str = err.stack
        for (let key in err)
        {
            if (key == "message")
                continue
            if (key == "stack")
                continue

            err_str += `\n${key}:  ${err[key]}`
        }

        return `[${new Date(now).format("yyyy-MM-dd hh:mm:ss")}] [${logger.name}] \n${err_str}`
    }

    return `[${new Date(now).format("yyyy-MM-dd hh:mm:ss")}] [${logger.name}] ${args}`
}

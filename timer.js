const timer_manager = module.exports = {}
let bsearch = require("binary-search")
const setTimeout = global.setTimeout
const clearTimeout = global.clearTimeout
const queen = global.queen

function cmp(first, second)
{
    if (second.next_time === first.next_time)
        return first.id - second.id

    return first.next_time - second.next_time
}

//定时器集合
let timers = []
let timers_map = {}
//驱动的原生定时器
let poll_timer = undefined
let timer_id_helper = 0

//偏移的时间base
let time_offset = 0

timer_manager.check_timeout = function ()
{
    let now = timer_manager.now_ms()
    let cbs = []
    while (true)
    {
        let first = timers[0]
        if (!first)
            break

        if (first.next_time > now)
            break

        //删除
        timers.splice(0, 1)
        delete timers_map[first.id]
        //避免在这个逻辑里会出现的不可控情况，保护好关键逻辑
        cbs.push(first.cb)
        if (first.is_recurring)
            timer_manager.add_timer(first)
    }

    timer_manager.reset_timeout()

    for (let cb of cbs)
    {
        try
        {
            cb()
        }
        catch (e)
        {
            queen.error(e)
        }
    }
}

timer_manager.reset_timeout = function ()
{
    if (poll_timer)
        clearTimeout(poll_timer)

    poll_timer = null

    let first = timers[0]
    if (!first)
        return

    let now = timer_manager.now_ms()

    let delay = Math.max(0, first.next_time - now)
    poll_timer = setTimeout(timer_manager.check_timeout, delay)
}

timer_manager.new_timer = function (info)
{
    let timer = {
        id: ++timer_id_helper,
        cb: info.cb,
        delay: info.delay,
        is_recurring: info.is_recurring,
    }

    return timer
}

timer_manager.add_timer = function (timer)
{
    if (timers_map[timer.id])
        return

    //补偿式
    let ms = timer.next_time
    if (!ms)
        ms = timer_manager.now_ms()

    timer.next_time = ms + timer.delay

    let index = bsearch(timers, timer, cmp)
    index = -index - 1

    timers.splice(index, 0, timer)

    //如果是第一个，需要重新刷新定时器
    if (timers[0] === timer)
        timer_manager.reset_timeout()

    timers_map[timer.id] = timer
    return timer.id
}

timer_manager.after = function (ms, cb)
{
    let timer = timer_manager.new_timer({ delay: ms, cb })
    timer_manager.add_timer(timer)

    return timer.id
}

timer_manager.every = function (ms, cb)
{
    let timer = timer_manager.new_timer({ delay: ms, cb, is_recurring: true })
    timer_manager.add_timer(timer)

    return timer.id
}

timer_manager.del = function (id)
{
    let timer = timers_map[id]

    let index = bsearch(timers, timer, cmp)
    if (timers[index] !== timer)
        throw new Error("timer no match.")

    timers.splice(index, 1)
    delete timers_map[id]
}

//获取当前时间
timer_manager.now_sec = function ()
{
    return Math.floor((Date.now() + time_offset) / 1000)
}

timer_manager.now_ms = function ()
{
    return Date.now() + time_offset
}

timer_manager.set_time_to = function (date)
{
    //比较
    let now = Date.now()
    let gap = date - now

    time_offset = gap
    timer_manager.reset_timeout()
}

global.now_sec = timer_manager.now_sec
global.now_ms = timer_manager.now_ms

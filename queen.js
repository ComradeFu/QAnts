const queen = module.exports = {}

const bsearch = require("binary-search")
const path = require("path")

const Ant = require("./ant")
const templates = require("./templates")
const workers = require("./workers")
const awesome = require("awesome-async")
const hot_fix = require("./hot_fix")

const config = require("./config")
const timer = require("./timer")

const setTimeout = global.setTimeout

const ants = new Map()          //[id] = ant
const sorted_ants = []
const names = new Map()         //[name] = ant

const reses = {} // queen 提供的资源缓存。get set 借口对其进行使用

let timer_loop = null
let quit = 0               //0:running,1:quiting 2:quited
let id = 0
let ant_id_offset = 24 //ant id 相对 workers 的偏移
let max_id = Math.pow(2, ant_id_offset) //最大的id

let queen_logger = undefined
let boot_code = undefined

// eslint-disable-next-line func-style
const cmp = function (first, target)
{
    return target - first.id
}


queen.init = async function ()
{
    await queen.run_logger()

    await templates.run()

    await hot_fix.run()

    await queen.check_quit()

    //注册意外退出处理
    await queen.regist_uncaught_exception()
}

queen.run = async function ()
{
    //启动配置文件
    await queen.boot()
}

//不正常的 err
queen.regist_uncaught_exception = function ()
{
    process.on('uncaughtException', function (err)
    {
        // err.message = `捕捉到意外的错误 uncaughtException: ${err.message}`
        queen.fatal(err)
    })

    process.on('unhandledRejection', (err) =>
    {
        // err.message = `捕捉到意外的错误 unhandledRejection: ${err.message}`
        queen.fatal(err)
    });
}

queen.sorted_ants = function ()
{
    return sorted_ants
}

queen.names = function ()
{
    return names
}

/**
 * 创建一个蚂蚁
 */
queen.spawn = function (name, ...args)
{
    // queen.log(`spawning ${ global.object_string(name) } `)

    if (quit > 0)
    {
        throw new Error(`ants is quitting`)
    }

    let cf = name

    if (typeof (name) == "string")
    {
        cf = {
            template: name,
            args: args,
        }
    }

    cf.args = cf.args || []

    const template = templates.load(cf.template)
    if (template == null)
    {
        throw new Error(`no such template ${cf.template} `)
    }

    const ant = queen.born(template, cf.name)
    ant.service = cf.service

    if (cf.name != null)
    {
        queen.regist(ant.id, cf.name)
    }

    // queen.log("@spawn", `${ cf.template } (${ cf.args.toString() })[${ ant.id }]`)

    ant.push_msg([0, "i", ...cf.args])

    queen.schedule_later(ant)

    return ant.id
}
/**
 * 
 */
queen.cspawn = async function (name, ...args)
{
    let cf = name

    let send_by_name = typeof (name) == "string"
    if (send_by_name)
    {
        cf = {
            template: name,
            args: args,
        }
    }

    cf.args = cf.args || []

    let id = await workers.gspawn(cf)

    //马上注册
    if (send_by_name)
        workers.regist(name, id)

    return id
}

/**
 * 本地查找对应的ant
 */
queen.find = function (target)
{
    let ant = null
    if (typeof (target) == "number")
    {
        return ants.get(target)
    }

    target = names.get(target)

    if (target == null)
    {
        return
    }

    ant = ants.get(target)

    return ant
}

/**
 * 发送消息
 */
queen.send = function (from, to, ...args)
{
    let target = to

    if (typeof (to) == "string")
    {
        target = names.get(to)
        if (target == null)
        {
            target = workers.find(to)
        }
    }

    if (target == null)
    {
        if (args[0] != "t")
        {
            let extra_stack = {}
            Error.captureStackTrace(extra_stack)

            queen.log("@send", `no such ant 1 ${from}: ${to} ${JSON.stringify(args)}, ${extra_stack.stack} `)
        }

        return false
    }

    let worker_id = target >> ant_id_offset

    if (workers.__index != worker_id)
    {
        workers.send_by_id(worker_id, from, target, ...args)
        return true
    }

    let ant = ants.get(target)

    if (ant == null)
    {
        if (args[0] != "t")
        {
            let extra_stack = {}
            Error.captureStackTrace(extra_stack)

            queen.log("@send", `no such ant 2 ${from}: ${to} ${JSON.stringify(args)} ${extra_stack.stack} `)
        }

        return false
    }

    args.unshift(from)
    ant.push_msg(args)

    queen.schedule_later(ant)
    return true
}

/**
 * call 消息，会丢报错
 */
queen.call = function (from, to, ...args)
{
    let target = to

    if (typeof (to) == "string")
    {
        target = names.get(to)
        if (target == null)
        {
            target = workers.find(to)
        }
    }

    if (target == null)
    {
        if (args[0] != "t")
        {
            throw new Error(`no such ant 1 ${from}: ${to} ${JSON.stringify(args)} `)
        }
    }

    let worker_id = target >> ant_id_offset

    if (workers.__index != worker_id)
    {
        workers.send_by_id(worker_id, from, target, ...args)
        return
    }

    let ant = ants.get(target)

    if (ant == null)
    {
        if (args[0] != "t")
        {
            throw new Error(`no such ant 2 ${from}: ${to} ${JSON.stringify(args)} `)
        }
    }

    args.unshift(from)
    ant.push_msg(args)

    queen.schedule_later(ant)
}

queen.run_after = function (from, session, delay)
{
    if (process.env.NODE_ENV == "development")
    {
        timer.after(delay, () =>
        {
            queen.send(0, from, "t", session)
        })

        return
    }

    setTimeout(() =>
    {
        queen.send(0, from, "t", session)
    }, delay);
}

queen.sleep = function (ms)
{
    return new Promise(function (resolve)
    {
        global.setTimeout(resolve, ms)
    })
}

/**
 * 杀死某只蚂蚁
 */
queen.kill = function (remote)
{
    queen.send(0, remote, "q")
}

/**
 * 全体退出
 */
queen.gexit = function ()
{
    workers.gexit()
}

/**
 * 自己退出
 */
queen.myself_exit = async function ()
{
    queen.log(`@mysql_exit`, `queen exit!!!`)

    if (quit > 0)
    {
        return
    }

    quit = 1

    for (let i = 0; i < sorted_ants.length; ++i)
    {
        const ant = sorted_ants[i]

        queen.kill(ant.id)
    }
}

queen.born = function (template)
{
    id++

    if (id > max_id)
    {
        id = max_id
        throw Error(`ant id 资源耗竭！${id} `)
    }

    let ant_id = workers.__index << ant_id_offset | id

    const ant = new Ant(ant_id, queen, template)

    ants.set(ant_id, ant)

    sorted_ants.splice(~bsearch(sorted_ants, ant_id, cmp), 0, ant)

    template.ants.splice(~bsearch(template.ants, ant_id, cmp), 0, ant)

    return ant
}

queen.catch = function (e)
{
    queen.log(e)
}

queen.regist = function (remote, name)
{
    let ant = queen.find(remote)
    if (ant == null)
    {
        return
    }

    let exist = names[name]

    if (exist != null)
    {
        delete exist.name
    }

    ant.names.add(name)

    names.set(name, ant.id)

    workers.regist(name, ant.id)
}

queen.unregist = function (name)
{
    let exist = names.get(name)

    if (exist == null)
    {
        return
    }

    names.delete(name)

    workers.unregist(name)
}

queen.query = function (name)
{
    let exist = names.get(name)
    if (exist)
    {
        return exist
    }

    exist = workers.find(name)

    return exist
}

/**
 * 完全退出后，埋葬蚂蚁
 */
queen.bury = function (ant)
{
    // queen.log(`bury ant: ${ ant.id } `)

    if (ants.delete(ant.id) == false)
    {
        return
    }

    let template = ant.template

    for (let name of ant.names)
    {
        queen.unregist(name)
    }

    ant.names.clear()

    sorted_ants.splice(bsearch(sorted_ants, ant.id, cmp), 1)
    template.ants.splice(bsearch(template.ants, ant.id, cmp), 1)
}

//双队列调度，保证调度时的执行层次问题（只执行一层）
let global_ants_queue = []
let waiting_ants_queue = []

let tmp_queue = null

//切换双队列
queen.swap = function ()
{
    tmp_queue = global_ants_queue

    global_ants_queue = waiting_ants_queue
    waiting_ants_queue = tmp_queue

    tmp_queue = null
}

/**
 * 循环调度，
 * 注意，本函数不允许出现await调用
 */
queen.loop = function ()
{
    if (timer_loop)
    {
        timer_loop = null
    }

    //切换队列
    queen.swap()

    while (true)
    {
        let first = global_ants_queue.shift()
        if (first == null)
        {
            break
        }

        if (first.quit == 2)
        {
            continue
        }

        //第一次的话，将msgs切换过来
        if (!first.in_loop && first.wait_scheduling)
        {
            //本轮调度已经结束，可以进入次队列
            first.wait_scheduling = false
            first.in_loop = true

            first.swap()
        }

        first.update()

        //在本轮公平地执行完msgs
        if (first.msgs.length > 0)
        {
            global_ants_queue.push(first)
        }
        else
        {
            //从loop中移除
            delete first.in_loop
        }
    }
}

//插入待调度的队列里
queen.schedule_later = function (ant)
{
    if (ant.wait_scheduling == true)
    {
        return
    }

    ant.wait_scheduling = true

    waiting_ants_queue.push(ant)

    if (timer_loop == null)
    {
        timer_loop = true
        setImmediate(queen.loop)
        // process.nextTick(queen.loop)
    }
}

queen.check_quit = async function ()
{
    setTimeout(queen.check_quit, 500)

    if (quit == 0)
    {
        return
    }

    if (quit == 1 && ants.size == 0)      //1秒后真正退出
    {
        quit = 2
        queen.log("@check_quit", `queen is going to exit`)
        return
    }

    if (quit == 2)
    {
        //卸载资源
        let pros = []
        for (let key in reses)
        {
            let res = reses[key]
            if (res.unint)
                pros.push(res.unint)
        }

        await Promise.all(pros)

        queen.log("@check_quit", `queen is exit.`)
        workers.exit()
    }
}

// 对缓存的 get set
queen.get_res = function (key)
{
    return reses[key]
}

queen.set_res = function (key, val)
{
    reses[key] = val
}

queen.reses = function ()
{
    return reses
}

queen.hot_fix = function ()
{
    return hot_fix
}

queen.is_group_leader = function ()
{
    return workers.is_group_leader()
}

//分析启动参数
function analyse_boot(str)
{
    // eslint-disable-next-line require-unicode-regexp
    const patt = /(.*)\((.*)\)/g
    const array = patt.exec(str)

    return array
}

//启动必要组件
queen.run_logger = async function ()
{

    //启动日志资源
    let Logger = require("./logger")
    let logger = new Logger()

    //启动默认的日志消费资源
    let LogConsumer = require("./logcomsumerstd")
    let consumer = new LogConsumer()

    logger.add_consumer(consumer)

    //其他的日志
    let logconsummer = config.logconsummer || []
    for (let one of logconsummer)
    {
        let consumer_path = path.resolve(one.cls)
        let cls = require(consumer_path)
        let one_ins = new cls()

        await one_ins.init(one, queen)
        logger.add_consumer(one_ins)
    }

    queen.set_res("logger", logger)

    //设定日志等级
    if (config.log_level)
    {
        logger.set_level(config.log_level)
    }

    queen_logger = logger.logs(`queen[${workers.__index}]`)
}

//启动入口
queen.boot = async function ()
{
    //随机一个数字
    boot_code = Math.floor(Math.random() * 100000000)

    let loader = templates.get_loader()

    let array = analyse_boot(config.boot)
    if (!array)
    {
        //直接进入准备完毕
        queen.stand_by()
        return
    }

    const boot_path = array[1]
    if (!boot_path)
        return

    array.shift()
    array.shift()

    const whole = path.resolve(config.search, boot_path)

    let boot_func = loader("boot", whole)
    boot_func(queen, array[0])
}

//准备完毕
queen.stand_by = async function ()
{
    queen.ready = true

    //唤醒
    await awesome.wake("queen_ready")
}

queen.is_quit = function ()
{
    return quit > 0
}

queen.is_cluster_ready = function ()
{
    return workers.is_ready()
}

queen.get_boot_code = function ()
{
    return boot_code
}

queen.set_time_to = function (date)
{
    if (process.env.NODE_ENV != "development")
        return

    queen.do_set_time_to(date)
    workers._broad({
        type: "set_time_to",
        args: [date]
    })
}

queen.do_set_time_to = function (date)
{
    queen.log(`set time to:${date}`)
    timer.set_time_to(date)
}

queen.query_ant = async function (id_or_name)
{
    let old = id_or_name
    if (typeof (id_or_name) == "string")
    {
        id_or_name = queen.query(id_or_name)
    }

    if (!id_or_name)
    {
        return
    }

    let worker_id = id_or_name >> ant_id_offset
    if (workers.__index == worker_id)
    {
        let ant = ants.get(id_or_name)
        if (ant)
        {
            return { id: ant.id }
        }
    }
    else
    {
        let ret = await workers.query_ant(worker_id, id_or_name)
        return ret
    }
}

//可被替换
queen.on_signal = function (signal)
{
    queen.log(`default queen signal recive ${signal} !!!`)

    queen.myself_exit()
}

queen.get_worker_id = function ()
{
    return workers.__index
}

queen.get_worker_count = function ()
{
    return config.worker_count
}

//热更的监听
let hotfix_handlers_id = 0
let hotfix_handlers = {}
let hotfix_handlers_names = {}
queen.add_hotfix_handler = function (name, func)
{
    assert(typeof name == "string", name)

    let name_handlers = hotfix_handlers[name]
    if (!name_handlers)
        name_handlers = hotfix_handlers[name] = {}

    let id = ++hotfix_handlers_id
    name_handlers[id] = {
        name, func
    }

    hotfix_handlers_names[id] = name
    return id
}

queen.remove_hotfix_handler = function (id)
{
    let name = hotfix_handlers_names[id]
    let name_handlers = hotfix_handlers[name]
    if (!name_handlers)
    {
        queen.error(`remove hotfix handler not found 1, id:${id}, name:${name}`)
        return
    }

    if (!name_handlers[id])
    {
        queen.error(`remove hotfix handler not found 2, id:${id}, name:${name}`)
        return
    }

    delete name_handlers[id]
}

hot_fix.on_hotfix = function (watcher)
{
    let { name } = watcher

    let name_handlers = hotfix_handlers[name]
    if (!name_handlers)
        return

    for (let id in name_handlers)
    {
        let handler = name_handlers[id]
        try
        {
            handler.func()
        }
        catch (e)
        {
            queen.error(e)
        }
    }
}

// --------------------------------- 新增日志 ---------------------------------

//等同于info
queen.log = function (...args)
{
    queen_logger.info(...args)
}

//
queen.debug = function (...args)
{
    queen_logger.debug(...args)
}

//
queen.info = function (...args)
{
    queen_logger.info(...args)
}

//
queen.warn = function (...args)
{
    queen_logger.warn(...args)
}

//
queen.error = function (...args)
{
    queen_logger.error(...args)
}

//
queen.fatal = function (...args)
{
    queen_logger.fatal(...args)
}

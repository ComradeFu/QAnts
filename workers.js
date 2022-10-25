const { workerData, parentPort } = require('worker_threads')
const workers = module.exports = { __index: workerData.index }

const buffer_op = require("buffer-op")
const box = buffer_op.box
const Stream = buffer_op.Stream

const config = require("./config")

const queen = require("./queen")
const smonitor = require("./smonitor")
let logger = undefined

const remote_names = new Map()             //[name] = id

const worker_list = []
//检查连接
let worker_start_count = 0
//检查就绪
let worker_init_count = 0

let is_ready = false

let session = 0
let worker_index = 0

const rpcs = {}

//暂且测试
if (process.env.NODE_ENV == "development-monitor")
{
    global.console.error(`booting[${config.index}] easy monitor.`)
    const easyMonitor = require("easy-monitor")
    easyMonitor({
        project_name: `monitor${workerData.config.monitor}-queen[${workerData.index}]`,
        profiler: {
            cpu: {
                optional: {
                    long_limit: 20,
                    top_limit: 20
                }
            }
        }
    });
}

async function main()
{
    parentPort.on('message', workers.on_message.bind(workers))

    workers.config(workerData.config)

    await queen.init()

    //拿到自己的 logger
    let logger_res = queen.get_res("logger")

    let logname = `worker[${workerData.index}]`
    logger = logger_res.logs(logname)

    //自己初始化完毕
    ++worker_init_count

    //等待所有的worker就绪后，启动
    workers.check_start()
}

async function init()
{
    //广播
    workers._broad({
        type: "init",
        id: workerData.index
    })
}

async function start()
{
    await init()

    workers.check_init()
}

async function run()
{
    is_ready = true
    await queen.run()
}

workers.config = function (cf)
{
    Object.assign(config, cf)

    config.cluster = config.cluster || 1
}


workers.on_message = function (event)
{
    if (event.args)
    {
        let stream = new Stream(event.args)
        event.args = box.unpack(stream)[0]
    }

    switch (event.type)
    {
        case "connect":
            workers.on_connect(this, event)
            break
        case "init":
            workers.on_init(this, event)
            break
        case "call":
            workers.on_call(this, event)
            break
        case "send":
            workers.on_send(this, event)
            break
        case "response":
            workers.on_response(this, event)
            break
        case "r":
            workers._on_regist(this, event)
            break
        case "d":
            workers._on_delete(this, event)
            break
        case "signal":
            workers.on_signal(this, event)
            break
        case "gexit":
            workers.on_gexit(this, event)
            break
        case "set_time_to":
            workers.on_set_time_to(this, event)
            break
        default:
            workers.on_unknown(this, event)
            break;
    }
}

workers.on_connect = function (queen, event)
{
    let id = event.id
    let port = event.port

    let worker = { id, port }

    worker_list[id] = worker
    port.on("message", workers.on_message.bind(worker))

    ++worker_start_count
    workers.check_start()
}

workers.check_start = function ()
{
    if ((worker_start_count + 1) == config.worker_count)
    {
        logger.debug(`worker connected, count:${config.worker_count}, prepare to start.`)
        start()
    }
}

workers.on_init = function (queen, event)
{
    ++worker_init_count
    workers.check_init()
}

workers.check_init = function ()
{
    if (worker_init_count == config.worker_count)
    {
        logger.debug(`worker inited, count:${worker_init_count}, prepare to boot queen.`)
        run()
    }
}

workers.on_call = async function (worker, event)
{
    try
    {
        switch (event.name)
        {
            case "gspawn":
                await workers.on_gspawn(worker, event)
                break
            case "spawn":
                await workers.on_spawn(worker, event)
                break
            case "qa":
                await workers.on_query_ant(worker, event)
                break
            case "monitor":
                await smonitor.on_monitor(worker, event)
                break
            default:
                await workers.on_unknown(worker, event)
                break
        }
    }
    catch (e)
    {
        //返回给对面反应，先简单这么处理（存在重复返回的可能）
        logger.error(e)
        workers.response(worker, event.session, undefined, e)
    }
}

workers.on_response = function (worker, event)
{
    const id = event.session
    const rpc = rpcs[id]
    if (!rpc)
    {
        logger.error(`revice response but no such rpc session:${id}, event:${global.object_string(event)}`)
        return
    }

    delete rpcs[id]

    if (event.error)
    {
        rpc.reject(event.error)
    }
    else
    {
        rpc.resolve(event.result)
    }
}

workers.on_send = function (worker, event)
{
    const { name, args } = event

    queen.send(...args)
}

workers.on_unknown = function (worker, event)
{

}

//------------------------------------------

/**
 * 作为底层的发送接口
 */
workers.post = function (worker, event)
{
    if (worker == workers)
    {
        let stream = box.pack(event.args)

        let new_event = Object.assign({}, event)
        new_event.args = stream.buffer

        //自己
        parentPort.postMessage(new_event)
    }
    else
    {
        let stream = box.pack(event.args)

        let new_event = Object.assign({}, event)
        new_event.args = stream.buffer

        worker.port.postMessage(new_event)
    }
}

workers.response = function (worker, session, result, error)
{
    workers.post(worker, {
        type: "response",
        session,
        result,
        error
    })
}

workers.send = function (worker, ...args)
{
    worker.post(worker, {
        type: "send",
        args
    })
}

workers.send_by_id = function (worker_id, ...args)
{
    if (worker_id == workerData.index)
    {
        return workers.on_send(workers, {
            type: "send",
            args
        })
    }

    let worker = worker_list[worker_id]
    workers.post(worker, {
        type: "send",
        args
    })
}

workers.call = function (worker, name, ...args)
{
    let id = ++session

    return new Promise(function (resolve, reject)
    {
        rpcs[session] = {
            session: id,
            resolve,
            reject
        }

        workers.post(worker, {
            type: "call",
            session: id,
            name,
            args
        })
    })
}

//收到主线程发过来的spawn请求
workers.on_gspawn = async function (worker, event)
{
    let id = await workers.gspawn(...event.args)
    workers.response(worker, event.session, id)
}

workers.on_spawn = function (worker, event)
{
    let event_args = event.args
    let [template, args] = event_args

    try
    {
        let id = workers.spawn(template, args)

        workers.response(worker, event.session, id)
    }
    catch (error)
    {
        workers.response(worker, event.session, null, error)
    }
}

//本地创建一个ant
workers.spawn = function (template, args)
{
    let id = queen.spawn(template, args)
    return id
}

/**
 * 全局创建
 */
workers.gspawn = async function (cf)
{
    if (workerData.index == 0)        //center
    {
        let is_myself = workers._choose_one()    //在组内随机一个
        if (is_myself === true)
        {
            return queen.spawn(cf)      //随机到自己，那么就直接创建了
        }

        let id = await workers.call(is_myself, "spawn", cf)

        return id
    }
    else    //ask center to spawn
    {
        let id = await workers.call(worker_list[0], "gspawn", cf)

        return id
    }
}

workers._choose_one = function ()
{
    ++worker_index

    let index = worker_index % config.worker_count
    if (index == 0)
        return true

    return worker_list[index]
}

workers.is_group_leader = function ()
{
    return workerData.index === 0
}

//确认某个id的ant是否存在
workers.query_ant = async function (worker_id, id)
{
    let worker = worker_list[worker_id]

    let info = await workers.call(worker, "qa", id)
    return info
}

workers.on_query_ant = async function (worker, event)
{
    let [id] = event.args

    let info = await queen.query_ant(id)
    workers.response(worker, event.session, info)
}

/**
 * 注册
 */
workers.find = function (name)
{
    return remote_names.get(name)
}

workers.regist = function (name, id)
{
    workers._broad({
        type: "r", args: { names: name, id }
    })
}

workers.unregist = function (name, id)
{
    workers._broad({
        type: "d", args: { names: name }
    })
}

workers._broad = function (msg)
{
    for (let worker of worker_list)
    {
        if (!worker)
            continue
        workers.post(worker, msg)
    }
}

workers._on_regist = function (worker, event)
{
    let { names, id } = event.args
    if (typeof (names) == "string")     //单个添加
    {
        remote_names.set(names, id)
    }
    else
    {
        for (let [name, id] of names)
        {
            remote_names.set(name, id)
        }
    }
}

/**
 * 删除注册
 */
workers._on_delete = function (worker, event)
{
    //单个
    let { names } = event
    remote_names.delete(names)
}

workers.on_signal = function (worker, event)
{
    let { signal } = event

    //发送信息
    if (queen.on_signal)
    {
        queen.on_signal(signal)
    }
}

workers.gexit = function ()
{
    workers._broad({
        type: "gexit"
    })

    //自己也退出
    queen.myself_exit()
}

workers.on_gexit = function ()
{
    queen.myself_exit()
}

workers.on_set_time_to = function (worker, event)
{
    const { name, args } = event

    queen.do_set_time_to(...args)
}

workers.exit = function ()
{
    process.exit(0)
}

workers.is_ready = function ()
{
    return is_ready
}

main()

module.exports = workers

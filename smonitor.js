const smonitor = {}
const router = {}

const workers = require("./workers")
const queen = require("./queen")
const templates = require("./templates")

function route(url, handler)
{
    router[url] = handler
}

smonitor.on_monitor = async function (worker, event)
{
    let args = event.args
    let { type } = args[0]

    switch (type)
    {
        case "states":
            await smonitor.states(worker, event)
            break
        default:
            await smonitor.route(worker, event)
            break
    }
}

smonitor.states = async function (worker, event)
{
    let args = event.args[0]
    let { name } = args
    name = name || "all"

    let handlers = smonitor[`states_${name}`]

    let ret = await handlers(args.args)
    workers.response(worker, event.session, ret)
}

//整体的情况
smonitor.states_all = function (args)
{
    const ants = queen.sorted_ants()

    return {
        ants: ants.length,
        templates: templates.items().size,
    }
}

// 内存情况
smonitor.states_mem = function (args)
{
    return process.memoryUsage()
}

// cpu 情况
smonitor.states_cpu = async function (args)
{
    //windows暂时不支持
    const os = require('os')
    if (os.platform() == "win32")
        return { cpu_percent: 0 }

    //mac
    if (os.platform() == "darwin")
        return { cpu_percent: 0 }
    
    //在linux系统中，每1s，每颗u都会有100个时间片，所以能根据这个为基数，算出百分比
    let base_ms = 2000
    let base_cpu_time = 100 * (base_ms / 1000)

    let cpu_time = await smonitor.collect_cpu_time(base_ms)
    return {
        cpu_percent: cpu_time / base_cpu_time * 100
    }
}

//收集时间内（ms）cpu使用时间
smonitor.collect_cpu_time = async function (ms)
{
    let now_use_time = await smonitor.read_cpu_time()
    let pro = new Promise((resolve, reject) =>
    {
        global.setTimeout(async () =>
        {
            let later_use_time = await smonitor.read_cpu_time()
            resolve(later_use_time - now_use_time)
        }, ms)
    })

    return pro
}

smonitor.read_cpu_time = async function ()
{
    //收集500ms
    let fs = require('fs')
    let util = require("util")

    let readFilePromise = util.promisify(fs.readFile);

    let content = await readFilePromise(`/proc/${process.pid}/stat`)
    let elems = content.toString().split(' ')

    let utime = parseInt(elems[13])
    let stime = parseInt(elems[14])

    //总占用cpu的时钟数是 utime（用户态）+ stime（内核态）
    let all_time = utime + stime
    return all_time
}

function msg_count_cmp(a, b)
{
    return b.msg_count - a.msg_count
}

function pick_top_ant(snapshot)
{
    let pick_count = 10

    let ants = []
    for (let id in snapshot)
    {
        let one = snapshot[id]
        ants.push(one)
    }

    ants.sort(msg_count_cmp)

    return ants.slice(0, pick_count)
}

smonitor.collect_top_ant = async function ()
{
    let snapshot = await smonitor.top_ant_snapshot()
    //选出目前为止消息号最多的
    let top = pick_top_ant(snapshot)

    let ms = 1000 //1s内
    //选出2s内最高增长的ant
    let pro = new Promise((resolve, reject) =>
    {
        global.setTimeout(async () =>
        {
            let snapshot_diff = await smonitor.top_ant_snapshot(snapshot)
            let top_diff = pick_top_ant(snapshot_diff)
            resolve({
                top, top_diff
            })
        }, ms)
    })

    return pro
}

//有 last_snapshot 会给出diff
smonitor.top_ant_snapshot = async function (last_snapshot)
{
    let snapshot = {}
    let ants = queen.sorted_ants()
    for (let ant of ants)
    {
        let msg_count = ant.msg_count
        if (last_snapshot)
        {
            let old_msg_count = last_snapshot[ant.id] && last_snapshot[ant.id].msg_count || 0
            msg_count -= old_msg_count
        }

        snapshot[ant.id] = {
            id: ant.id,
            template: ant.template.name,
            msg_count
        }
    }

    return snapshot
}

smonitor.route = async function (worker, event)
{
    let args = event.args[0]
    let url = args.url
    let handlers = router[url] || smonitor.route_default

    let ret = await handlers(args.args)
    workers.response(worker, event.session, ret)
}

smonitor.route_default = function (worker, args)
{
    return "not found"
}

route("/ant_run", async function (args)
{
    let id_or_name = Number(args.id) || args.id
    let ant = queen.find(id_or_name)

    if (ant == null)
    {
        return null
    }

    let code = args.code || "ant.log('hello')"
    queen.log(`run code : return ${code}`)

    // eslint-disable-next-line no-new-func
    let ret_func = new Function("ant", "return " + code)
    return ret_func(ant)
})

route("/top_ant", async function ()
{
    let ret = await smonitor.collect_top_ant()
    return ret
})

module.exports = smonitor

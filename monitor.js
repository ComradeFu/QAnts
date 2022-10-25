const monitor = module.exports = {}

const config = require("./config")

const Koa = require('koa')
const Router = require('koa-router')
const bodyParser = require('koa-bodyparser')
const app = new Koa()
const router = new Router()

const main = require("./main")

monitor.run = function ()
{
    if (config.monitor == null)
    {
        return
    }

    router.use(bodyParser({
        enableTypes: ['json', 'form'],
        extendTypes: {
            json: ['application/x-javascript'] // will parse application/x-javascript type body as a JSON string
        }
    }))

    app.use(router.routes())
    app.use(router.allowedMethods())

    app.listen(config.monitor)
}

//states 类型属于收集型
router.get("/states/:name", async function (ctx)
{
    let name = ctx.params.name
    let args = ctx.request.request

    let workers = main.workers()

    let pros = []
    let rets = []
    let index = 0
    for (let one of workers)
    {
        pros.push(async function ()
        {
            let info = await main.call(one, "monitor", {
                type: "states",
                name,
                args
            })

            rets[index] = info
            ++index
        }())
    }

    await Promise.all(pros).catch((e) =>
    {
        global.console.error(e)
    })

    //收集好之后，进行total
    let total = {}
    for (let one of rets)
    {
        if (!one)
            continue

        for (let key in one)
        {
            let old_val = total[key] || 0
            total[key] = old_val + Number(one[key])
        }
    }

    ctx.body = {
        name,
        rets,
        total
    }
})

function msg_count_cmp(a, b)
{
    return b.msg_count - a.msg_count
}

//收集ant的msg count 负载情况
router.get("/top_ant", async function (ctx)
{
    let name = ctx.params.name
    let args = ctx.request.request

    let workers = main.workers()

    let pros = []
    let rets = []

    let index = 0
    for (let one of workers)
    {
        pros.push(async function ()
        {
            let info = await main.call(one, "monitor", {
                url: "/top_ant",
                args
            })

            rets[index] = info
            ++index
        }())
    }

    await Promise.all(pros)

    //分开两处
    let rets_top = []
    let rets_top_diff = []

    //选中之后，再选出最高负载
    let ants_top = []
    let ants_top_diff = []
    for (let one of rets)
    {
        ants_top.push(...one.top)
        ants_top_diff.push(...one.top_diff)

        rets_top.push(one.top)
        rets_top_diff.push(one.top_diff)
    }

    ants_top.sort(msg_count_cmp)
    ants_top_diff.sort(msg_count_cmp)

    let pick_count = 10
    ctx.body = {
        top: ants_top.slice(0, pick_count),
        top_diff: ants_top_diff.slice(0, pick_count),
        rets_top,
        rets_top_diff
    }
})

//其他的请求全部进行转发
router.get("/*", async function (ctx)
{
    let url = ctx.request.path
    let args = ctx.request.query

    let workers = main.workers()

    let pros = []
    let rets = []

    let index = 0
    for (let one of workers)
    {
        pros.push(async function ()
        {
            let info = await main.call(one, "monitor", {
                url,
                args
            })

            rets[index] = info
            ++index
        }())
    }

    await Promise.all(pros)

    ctx.body = {
        url,
        args,
        rets
    }

})

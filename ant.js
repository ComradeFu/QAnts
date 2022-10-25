module.exports = class Ant
{
    constructor(id, queen, template)
    {
        this.id = id
        this.names = new Set()      //注册过的名字

        this.quit = 0               //0:running,1:quiting 2:quited
        this.scheduling = false

        this.queen = queen
        this.template = template

        this.db = new Map()

        this.session = 0

        //消息双队列
        this.msgs = []
        this.wait_msgs = []

        this.msgs_swap_tmp = null

        this.pendings = []
        this.executing_pendings = false

        this.timers = new Map()             //[timer_id] = func

        this.catch_ = this.error       //捕捉异常
        this.rpc = new Map()

        //obj pool 请求的池
        this.objects_pool = []

        //热更的池
        this.hotfix_handlers = {}

        //拿到自己的 logger
        let logger = queen.get_res("logger")

        let logname = `${this.template.name}.${this.id}`
        this.logger = logger.logs(logname)

        this.set_logger_tag("ant_template", this.template.name)
        this.set_logger_tag("ant_id", this.id)

        this.extra = {}

        this.msg_count = 0 //处理的消息数量
    }

    /**
     * 获取自身id
     */
    self()
    {
        return this.id
    }

    /**
     * spawn(name,...args)
     * spawn({
     *  template:name,
     *  args:[],
     *  name:xxx,
     * })
     * @param {蚂蚁的配置} args 
     */
    spawn(...args)
    {
        return this.queen.spawn(...args)
    }
    /**
     * 在随机某个cluster生成对应的实体
     * spawn(name,...args)
     * spawn({
     *  template:name,
     *  args:[],
     *  name:xxx,
     * })
     * @param {*} args
     * @returns
     */
    async cspawn(...args)
    {
        return await this.queen.cspawn(...args)
    }

    /**
     * 注册全局名称
     * @param {全局名称} name 
     */
    regist(name)
    {
        this.names.add(name)
        this.queen.regist(this.id, name)
    }

    /**
     * 反注册名称
     */
    unregist(name)
    {
        this.names.del(name)
        this.queen.unregist(name)
    }

    query(name)
    {
        return this.queen.query(name)
    }

    fork(func)
    {
        this.pendings.push(func)
        this.queen.schedule_later(this)
    }

    //交换队列
    swap()
    {
        this.msgs_swap_tmp = this.wait_msgs
        this.wait_msgs = this.msgs

        this.msgs = this.msgs_swap_tmp

        this.msgs_swap_tmp = null
    }

    push_msg(msg)
    {
        this.wait_msgs.push(msg)
    }

    update()
    {
        this.update_msgs()
        this.update_pendings()
    }
    async update_msgs()
    {
        let msg = this.msgs.shift()
        if (msg == null)
        {
            return
        }

        try
        {
            this.msg_count++
            this.msg_count = Math.min(100000000, this.msg_count)

            await this.update_msg(...msg)
        }
        catch (e)
        {
            this.error(e)
        }
    }

    async update_msg(from, cmd, ...args)
    {
        switch (cmd)
        {
            case "i":
                {
                    await this.on_init(from, ...args)
                }
                break
            case "c":
                {
                    await this.on_call(from, ...args)
                }
                break
            case "s":
                {
                    await this.on_send(from, ...args)
                }
                break
            case "r":
                {
                    await this.on_resp(from, ...args)
                }
                break
            case "t":
                {
                    await this.on_timer(from, ...args)
                }
                break
            case "n":
                {
                    await this.on_next_tick(from, ...args)
                }
                break
            case "e":
                {
                    await this.on_throw(from, ...args)
                }
                break
            case "q":
                {
                    await this.on_quit()
                }
                break
            default:
                {
                    await this.on_default_msg(from, ...args)
                }
                break
        }
    }

    async update_pendings()
    {
        while (this.executing_pendings)
        {
            //等待上一次结束
            await this.sleep(100)
        }

        let temp = this.pendings
        if (temp.length == 0)
        {
            return
        }

        this.executing_pendings = true

        this.pendings = []

        let pends = []
        let that = this
        for (let pending of temp)
        {
            //两个catch分别对应：1、pending 是普通函数；2、 pending 是async 函数
            try
            {
                pends.push(Promise.resolve(pending()))
            }
            catch (err)
            {
                that.catch_(err)
            }
        }

        //同时并发
        await Promise.all(pends).catch((e) =>
        {
            that.catch_(e)
        })

        this.executing_pendings = false

        //重新尝试执行一次
        await this.update_pendings()
    }

    set(key, val)
    {
        this.db.set(key, val)
    }

    get(key)
    {
        return this.db.get(key)
    }

    set_res(key, val)
    {
        this.queen.set_res(key, val)
    }

    get_res(key)
    {
        return this.queen.get_res(key)
    }

    /**
     * 获取 一个obj对象
     */
    get_obj_cache()
    {
        let one = this.objects_pool.shift()
        if (one == null)
        {
            one = {}
            // console.log("new object !")
        }
        return one
    }

    /**
     * 还回 去一个obj
     */
    cache_obj(obj)
    {
        for (let key in obj)
        {
            delete obj[key]
        }
        // console.log(`push obje ${obj}`)
        this.objects_pool.push(obj)
    }

    on_msg(cb)
    {
        this.cb_ = cb
    }

    async on_init(from, ...args)
    {
        let req = {
            from: from,
            method: "init",
            args: args,
            headers: {},
        }

        await this.template.dispatch(null, this, req)
    }

    call(remote, method, ...args)
    {
        const rpc = {}

        let extra_stack = {}
        Error.captureStackTrace(extra_stack)

        this.cur_stack = extra_stack.stack

        this.session++
        this.queen.call(this.id, remote, "c", this.session, method, ...args)

        this.rpc.set(this.session, rpc)

        let that = this
        let cur_method = that.cur_method

        let session = this.session
        return new Promise(function (resolve, reject)
        {
            rpc._expire_timer = global.setTimeout(() =>
            {
                that.rpc.delete(session)
                reject(new Error(`RPC from ${that.id}, to ${remote} ${method} 调用超时`))

                that.log(`rpc 在处理 ${cur_method} 消息中，调用 ${remote} 发生超时。 参数：${JSON.stringify(args, null, 2)}, 堆栈${extra_stack.stack}`)
            }, 1000 * 30)

            rpc.resolve = resolve
            rpc.reject = reject
        })
    }

    async on_call(from, session, method, ...args)
    {
        let req = {
            from: from,
            session: session,
            method: method,
            args: args,
            headers: {},
        }

        if (this.quit > 0)
        {
            this.throw(req, new Error("this ant has already quit"))
            return
        }

        try
        {
            await this.template.dispatch(null, this, req)
        }
        catch (e)
        {
            this.throw(req, e)
            return
        }

        //没有返回值，现在直接返回null，以前返回Error（参考blame）
        if (req.session != null && !req.donot_ret)
        {
            this.ret(req)
        }
    }

    send(remote, method, ...args)
    {
        this.queen.send(this.id, remote, "s", method, ...args)
    }

    async on_send(from, method, ...args)
    {
        let req = this.get_obj_cache()
        req.from = from
        req.method = method
        req.args = args
        req.headers = this.get_obj_cache()

        if (this.quit > 0)
        {
            this.log(`this message is throw because of quit`)
            return
        }

        await this.template.dispatch(null, this, req)

        this.cache_obj(req.headers)
        this.cache_obj(req)
    }

    //返回对端的 call
    ret(req, result)
    {
        if (req.session == null)
        {
            this.log(`repeat ant.ret ! in method :${req.method}`)
            return
        }

        this.queen.send(this.id, req.from, "r", req.session, result)

        delete req.session
    }

    on_resp(from, session, result)
    {
        let cur_stack = this.cur_stack
        this.cur_stack = null

        let rpc = this.rpc.get(session)
        if (rpc == null)
        {
            throw new Error(`no such resp while in ${cur_stack}`)
        }

        //定时器
        assert(rpc._expire_timer)
        global.clearTimeout(rpc._expire_timer)

        delete rpc._expire_timer

        this.rpc.delete(session)

        rpc.resolve(result)
    }

    async on_timer(from, session)
    {
        let req = {
            from: from,
            method: "timer",
            args: [session],
            headers: {}
        }
        await this.template.dispatch(null, this, req)
    }

    async on_next_tick(from, ...args)
    {
        let req = {
            from: from,
            method: "next_tick",
            args,
            headers: {}
        }
        await this.template.dispatch(null, this, req)
    }

    /**
     * 返回错误到达对端
     * @param {接收的请求} req 
     * @param {错误信息} err 
     */
    throw(req, err)
    {
        this.queen.send(this.id, req.from, "e", req.session, err)
    }

    on_throw(from, session, err)
    {
        let rpc = this.rpc.get(session)
        if (rpc == null)
        {
            this.log(`handler method ${this.cur_method} but no such resp while throw err:${err}, stack:${this.cur_stack}`)
            return
        }

        this.rpc.delete(session)

        //定时器
        global.clearTimeout(rpc._expire_timer)
        delete rpc._expire_timer

        /*
         * let extra_stack = {}
         * Error.captureStackTrace(extra_stack)
         */

        // err.stack = `${err.stack}\n from ${extra_stack.stack}`

        rpc.reject(err)
    }

    catch(func)
    {
        this.catch_ = func
    }

    kill(remote)
    {
        this.queen.kill(remote)
    }

    /**
     * 整个进程退出
     */
    exit()
    {
        this.queen.mysql_exit()
    }

    /**
     * 退出
     */
    suicide()
    {
        if (this.quit > 0)
        {
            return
        }

        this.quit = 1
        this.queen.kill(this.id)
    }

    async on_quit()
    {
        this.log(`now quiting`)

        //不一定是 suicide
        this.quit = 1

        let req = {
            from: 0,
            method: "uninit",
            args: [],
            headers: {}
        }

        await this.template.dispatch(null, this, req)

        //等待pendings为空
        await this.update_pendings()

        this.queen.bury(this)
        this.quit = 2

        this.timers.clear()
        this.clear_hotfix_handler()

        this.log(`quited`)

        let logger = this.queen.get_res("logger")
        logger.del_log(this.logger.name)
    }

    //默认的消息处理
    async on_default_msg(from, cmd)
    {
        this.log(`无法识别的cmd :${cmd}， from :${from}`)
    }

    do(func)
    {
        this.pendings.push(func)
    }
    /**
     * 延迟执行
     * @param {延迟的时间} ms 
     * @param {操作} op 
     */
    after(ms, op)
    {
        this.session++

        let session = this.session

        this.queen.run_after(this.id, session, ms)

        let that = this
        this.timers.set(session, async function ()
        {
            that.timers.delete(session)

            await op()
        })

        return session
    }
    /**
     * 间隔执行
     * @param {延迟的时间} ms 
     * @param {操作} op 
     */
    every(ms, op)
    {
        this.session++

        let session = this.session

        this.queen.run_after(this.id, session, ms)

        let that = this

        this.timers.set(session, async function ()
        {
            that.queen.run_after(that.id, session, ms)

            await op()
        })

        return session
    }

    sleep(ms)
    {
        return this.queen.sleep(ms)
    }

    next_tick(func, ...args)
    {
        this.queen.send(0, this.id, "n", func, ...args)
    }

    /**
     * 清除一个定时器
     * @param  {定时器的id} id
     */
    del_timer(id)
    {
        this.timers.delete(id)
    }

    set_logger_tag(tag, val)
    {
        this.logger.tags[tag] = val
    }

    set_extra(key, val)
    {
        this.extra[key] = val
    }

    add_hotfix_handler(name, func)
    {
        let id = this.queen.add_hotfix_handler(name, func)
        this.hotfix_handlers[id] = func
    }

    clear_hotfix_handler()
    {
        for (let id in this.hotfix_handlers)
        {
            this.queen.remove_hotfix_handler(id)
        }

        this.hotfix_handlers = {}
    }

    /**
     * 记录log
     * @param  {记录log} args
     */
    log(...args)
    {
        this.logger.info(...args)
    }

    /**
     * 错误
     * @param {*} e 
     */
    error(...args)
    {
        this.logger.error(...args)
    }
}
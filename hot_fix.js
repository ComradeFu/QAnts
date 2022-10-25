const hot_fix = module.exports = {}
const queen = require("./queen")

let Module = module.constructor
let cache = Module._cache

let prefix = process.cwd()
let blacks = ["ants", "node_modules"]

//正在热更的（避免重复进行require）
let cache_hotfixing = {}

function _in_blacks(filename)
{
    for (let black of blacks)
    {
        if (filename.indexOf(black, prefix.length) > 0)
        {
            return true
        }
    }
    return false
}

function fix_one(filename, nest)
{
    //不重复同一帧的热更
    if (cache_hotfixing[filename])
        return

    queen.log("@hot_fix", `file fixing:${filename}`)

    let old_mod = cache[filename]
    if (old_mod == null)
    {
        return
    }

    if (old_mod.id == ".")
    {
        return
    }

    if (_in_blacks(filename) === true)
    {
        queen.log("3")

        return
    }

    //记录正在热更
    cache_hotfixing[filename] = true

    if (nest)
    {
        let children = old_mod.children
        for (let child of children)
        {
            fix_one(child.filename, nest)
        }
    }

    let old_exports = old_mod.exports
    delete cache[filename]

    try
    {
        let new_exports = require(filename)

        let new_mod = cache[filename]
        //还原旧模块，工具mod可以走了
        cache[filename] = old_mod

        new_mod.exports = old_exports

        for (let key in new_exports)
        {
            old_exports[key] = new_exports[key]
        }

        let tp = typeof old_exports
        //export 一个function，很可能是一个类的构建函数
        if (tp === "function")
        {
            //直接把prototype切换
            let old_prototype = old_exports.prototype
            let new_prototype = new_exports.prototype

            let keys = Object.getOwnPropertyNames(new_prototype)
            keys.forEach((key) =>
            {
                old_prototype[key] = new_prototype[key]
            })
        }

        /*
         *nodejs 中完全没有必要的父子模块维护 导致要做清理比较麻烦
         *更正：需要维护，这样热更才能做到自动有序化（与第一次启动require的顺序相同）
         */

        //释放新模块的资源
        let index = module.children.indexOf(new_mod)
        module.children.splice(index, 1);

        if (old_exports.on_hotfix)
            old_exports.on_hotfix()

        queen.log(`@hot_fix`, `file fix ok:${filename}`)
    }
    catch (e)
    {
        queen.log(`@hot_fix`, `file fix error:${e}`)
        cache[filename] = old_mod
    }
}

//监听文件变化
function watch_files()
{
    queen.log(`@hot_fix`, "watching files")

    const chokidar = require("chokidar")
    const path = require("path")

    const timers = {}

    const on_changed = function (path)
    {
        let exists = timers[path]
        if (exists)
        {
            return
        }
        timers[path] = setTimeout(() =>
        {
            delete timers[path]
            fix_one(path)
        }, 800)
    }

    const watcher = chokidar.watch([path.resolve("./configs"), path.resolve("./app")], { ignored: /(^|[\/\\])\../, ignorePermissionErrors: true })

    watcher.on('ready', () =>
    {
        watcher.on('change', on_changed);
        watcher.on('add', on_changed);
    })
}

/**
 * 监控的对象
 * {
 *      name: "watcher name" //同名会进行覆盖
 *      type: "folder" // folder、single
 *      path: "./configs" // 路径信息
 *      meta: {
 *          entrance: "index.js" //比如 folder 用到的，2s 进行收集，永远都要并且最后触发入口文件
 *      }
 * }
 */
const chokidar = require("chokidar")
const path = require("path")

let watchers = {} //
let waitings = {} //等待热更的watcher

//记录此watcher需要进行热更
let on_file_changed = function (watcher, path)
{
    watcher.change_files[path] = true
    waitings[watcher.name] = watcher

    watcher.last_time_change = global.now_ms()
}

let watch = function (info)
{
    let name = assert(info.name)
    let type = assert(info.type)
    let path = assert(info.path)
    let meta = info.meta || {}

    //重复的就不处理了
    if (watchers[name])
        return

    queen.debug(`@hotfix`, `adding [${name}], type ${type}, path ${JSON.stringify(path)}`)

    let watcher = {
        name, type, path, meta,
        change_files: {} //发生变动的文件
    }
    watchers[name] = watcher

    const chokidar_watcher = chokidar.watch(path, { ignored: /(^|[\/\\])\../, ignorePermissionErrors: true, ignoreInitial: true })
    chokidar_watcher.on('ready', () =>
    {
        chokidar_watcher.on('change', on_file_changed.bind(null, watcher));
        // chokidar_watcher.on('add', on_file_changed.bind(null, watcher)); //新增就不管了
    })

    return watcher
}

let hot_fix_folder = function (watcher)
{
    //文件夹模式，只对入口文件进行遍历性热更
    let entrance = watcher.meta.entrance
    fix_one(entrance, true)

    watcher.change_files = {}
}

let hot_fix_single = function (watcher)
{
    //单文件模式下，直接进行
    let change_files = watcher.change_files
    for (let file_path in change_files)
    {
        fix_one(file_path)
    }

    watcher.change_files = {}
}

//定时检查
let check_waitings = function ()
{
    let cur_waitings = waitings
    //清空
    waitings = {}
    let now = global.now_ms()
    for (let name in cur_waitings)
    {
        let watcher = cur_waitings[name]

        //如果更新时间没超过1s，放到下一轮再进行处理
        let last_time_change = watcher.last_time_change
        if (now - last_time_change < 1000)
        {
            waitings[name] = watcher
            continue
        }

        //否则进行热更
        if (watcher.type == "folder")
            hot_fix_folder(watcher)

        if (watcher.type == "single")
            hot_fix_single(watcher)

        //重置
        cache_hotfixing = {}

        if (hot_fix.on_hotfix)
            hot_fix.on_hotfix(watcher)
    }
}

//启动定时检查热更文件
let start_check_waitings = function ()
{
    setInterval(check_waitings, 100)
}

hot_fix.run = function ()
{

    start_check_waitings()

    /*
     * 
     * //暂时只提供在测试环境下的功能
     * if (process.env.NODE_ENV == "production")
     * {
     *     return
     * }
     */

    /*
     * //监听文件变化
     * watch_files()
     */
}

hot_fix.watch = watch

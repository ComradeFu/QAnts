const main = module.exports = {}

const path = require('path');
const { Worker, MessageChannel, SHARE_ENV } = require('worker_threads');

const buffer_op = require("buffer-op")
const box = buffer_op.box

const workers = []

const config = require("./config")
const console = global.console

let working_count = 0

let session = 0
let rpcs = {}

main.run = async function ()
{
    const count = config.worker_count
    const worker_path = path.join(__dirname, "workers.js")

    working_count = count

    for (let i = 0; i < count; i++)
    {
        const worker = new Worker(worker_path, {
            workerData: {
                index: i,
                config: config
            },
            env: SHARE_ENV,
        })

        worker.index = i

        worker.on('message', on_message.bind(worker))
        worker.on('error', on_error.bind(worker))
        worker.on('exit', on_exit.bind(worker, i))

        workers[i] = worker
    }

    await require("./monitor").run()

    connect()

    prepare_signal()
}

function on_message(event)
{
    switch (event.type)
    {
        case "response":
            on_response(this, event)
            break
        case "exit":
            req_exit(this, event)
            break
        default:
            on_unknown(this, event)
            break
    }
}

function on_error(event)
{
    console.log("on_error!!!!")
    console.log(event)
}

function on_exit(index, event)
{
    console.log("worker[%d] exit code:%d", index, event)

    --working_count
    if (working_count == 0)
    {
        console.log(`working worker count drops to 0, main exit.`)
        process.exit(0)
    }
}

function on_response(worker, event)
{
    const id = event.session
    const rpc = rpcs[id]
    if (!rpc)
    {
        global.console.error(`main revice response but no such rpc session:${id}, event:${global.object_string(event)}`)
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

//--------------------------------------------------

function connect()
{
    for (let i = 0; i < workers.length; i++)
    {
        const first = workers[i]

        for (let j = i + 1; j < workers.length; j++)
        {
            let second = workers[j]

            const channel = new MessageChannel()

            first.postMessage({
                type: "connect",
                id: j,
                port: channel.port1
            }, [channel.port1])

            second.postMessage({
                type: "connect",
                id: i,
                port: channel.port2
            }, [channel.port2])
        }
    }
}

function prepare_signal()
{
    //相当于 Ctrl + C
    process.on('SIGINT', function ()
    {
        console.log('main signal recive SIGINT !!!');
        notify_sig("SIGINT")
    });

    //相当于 Kill process
    process.on('SIGTERM', function ()
    {
        console.log('main signal recive SIGTERM !!!');
        notify_sig("SIGTERM")
    });
}

function notify_sig(sig)
{
    for (let worker of workers)
    {
        worker.postMessage({
            type: "signal",
            sig
        })
    }
}

main.call = function (worker, name, ...args)
{
    if (args)
    {
        let stream = box.pack(args)
        args = stream.buffer
    }

    let id = ++session
    return new Promise((resolve, reject) =>
    {
        rpcs[session] = {
            session,
            resolve,
            reject
        }

        worker.postMessage({
            type: "call",
            session: id,
            name,
            args
        })
    })
}

main.workers = function ()
{
    return workers
}

module.exports = main


const next_md = function (ant, req, next) { return next() }
const noop = function () { }

module.exports = class Template
{
    constructor(name)
    {
        this.name = name
        this.ants = []          //实例数组

        this.middlewares = []
    }

    use(middleware)
    {
        this.middlewares.push(middleware)
    }

    dispatch(next, ...args)
    {
        let index = -1
        let middlewares = this.middlewares

        return dispatch(0)

        function dispatch(i)        //这里在不停的创建函数 很不好
        {
            if (i <= index) return Promise.reject(new Error('next() called multiple times'))

            index = i

            let fn = middlewares[i]
            if (i === middlewares.length) fn = next

            if (!fn) return Promise.resolve()

            try
            {
                return Promise.resolve(fn(dispatch.bind(null, i + 1), ...args));
            }
            catch (err)
            {
                return Promise.reject(err)
            }
        }
    }
}

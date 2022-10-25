const config = module.exports = {}

config.monitor = undefined                  //用于查看本集群的信息

config.loader = ""                          //用于再加工启动
config.search = ""                          //搜索路径
config.boot = ""                            //启动参数
config.worker_count = 3 //require("os").cpus().length  //多线程数量

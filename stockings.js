#! /usr/bin/env node

let args = require('args')
let { client: ws } = require('websocket')
let fs = require('fs')
let path = require('path')
let crypto = require('crypto')
const EventEmitter = require('events');

let broker = 'wss://stockings-server.herokuapp.com'

let client = new ws()

client.on('connectFailed', err => console.error(err))

args.option('meta','Filter stream by metadata.', '', m => 
    m.split(' ').reduce((state, kv) => ({...state, [kv.split('=')[0]]: kv.split('=')[1]}), {})
)

args.command('scan', 'Scan files.', (_, [dir], opts) => {
    let files = fs.readdirSync(dir,{encoding: 'utf8', withFileTypes: true}).filter(dirent => dirent.isFile())
    for(let file of files) {
        let name = file.name
        let ext = path.extname(file.name)
        let meta = {
            name: opts.meta.name || name,
            ext: opts.meta.ext || ext
        }
        if(name == meta.name && ext == meta.ext) {
            let data = fs.readFileSync(path.join(dir, file.name), {encoding: 'base64url'})
            let hash = crypto.createHash('md5').update(data).digest('hex')
            let container = `data://name=${name};ext=${ext};hash=${hash}::${data}`
            console.log(container)
        }
    }
})

args.command('cat', 'Read file.', (_, [file], opts) => {
        let name = file
        let ext = path.extname(file)
        let meta = {
            name: opts.meta.name || name,
            ext: opts.meta.ext || ext
        }
        if(name == meta.name && ext == meta.ext) {
            let data = fs.readFileSync(file, {encoding: 'base64url'})
            let hash = crypto.createHash('md5').update(data).digest('hex')
            let container = `data://name=${name};ext=${ext};hash=${hash}::${data}`
            console.log(container)
        }
})

function STDIN() {
  const stdin = new EventEmitter();
  let buff = '';

  process.stdin
    .on('data', data => {
      buff += data;
      lines = buff.split(/\r\n|\n/);
      buff = lines.pop();
      lines.forEach(line => stdin.emit('line', line));
    })
    .on('end', () => {
      if (buff.length > 0) stdin.emit('line', buff);
    });

  return stdin;
}
/**
 * parseContainer
 * @param {String} c 
 */
let parseContainer = c => {
    if(!c.match(/data:\/\/(.+?)::(.+)/)) return false
    let [_, _m, data] = c.match(/data:\/\/(.+?)::(.+)/)
    let meta = _m.split(';').reduce((state, kv) => ({...state, [kv.split('=')[0]]: kv.split('=')[1]}), {})
    return {meta, data}
}

args.command('loc', 'Locate files.', (_, [metakey, dir], opts) => {
    let save = (c) => {
        fs.writeFileSync(path.join(dir, c.meta[metakey] + c.meta.ext), Buffer.from(c.data, 'base64url'))
        console.log('File saved:', c.meta[metakey] + c.meta.ext)
    }
    let stdin = STDIN()
    stdin.on('line', data => {
        let c = parseContainer(data)
        if(c) {
            if(opts.meta && Object.entries(opts.meta).every(([key, value]) => c.meta[key] == value)) save(c)
            if(!opts.meta) save(c)
        }
    })
})

args.command('sub', 'Subscribe to topic.', (_, [topic]) => {
    client.on('connect', con => {
        con.on('message', ({utf8Data: m}) => m.indexOf("greet") != 0 && console.log(m))
        con.on('close', () => {
            console.error('Closed. Try to reconnection...')
            client.connect(broker)
        })
        con.on('error', () => console.error('ERROR'))
        con.send(`sub ${topic}`)
    })
    client.connect(broker)
})

args.command('pub', 'Publish data to topic.', (_, [topic]) => {
    client.on('connect', con => {
        let stdin = STDIN()
        stdin.on('line', data => con.send(`pub ${topic}|${data}`))
        stdin.on('end', () => {
            console.log('Files published.')
            process.exit()
        })
    })
    client.connect(broker)
})

args.command('greet', 'Set greeting files for topic.', (_, [topic, dir], opts) => {
    client.on('connect', con => {
        con.on('message', ({utf8Data: data}) => {
            if(data.indexOf('greet') == 0) {
                let [_, $topic] = data.split(' ')
                if($topic == topic) {
                    let files = fs.readdirSync(dir,{encoding: 'utf8', withFileTypes: true}).filter(dirent => dirent.isFile())
                    for(let file of files) {
                        let name = file.name
                        let ext = path.extname(file.name)
                        let meta = {
                            name: opts.meta.name || name,
                            ext: opts.meta.ext || ext
                        }
                        if(name == meta.name && ext == meta.ext) {
                            let data = fs.readFileSync(path.join(dir, file.name), {encoding: 'base64url'})
                            let hash = crypto.createHash('md5').update(data).digest('hex')
                            let container = `data://name=${name};ext=${ext};hash=${hash}::${data}`
                            console.log('File published:', name)
                            con.send(`pub ${topic}|${container}`)
                        }
                    }
                }
            }
        })
    })
    client.connect(broker)
})

args.command('echo', 'Print files.', (_, __, opts) => {
    let save = (c) => {
        console.log(Buffer.from(c.data, 'base64url').toString('utf8'))
    }
    let stdin = STDIN()
    stdin.on('line', data => {
        let c = parseContainer(data)
        if(c) {
            if(opts.meta && Object.entries(opts.meta).every(([key, value]) => c.meta[key] == value)) save(c)
            if(!opts.meta) save(c)
        }
    })
})

args.parse(process.argv)
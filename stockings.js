#! /usr/bin/env node

let args = require('args')
let ws = require('ws').WebSocket
let fs = require('fs')
let crypto = require('crypto')
let { exec } = require('child_process')
let semver = require('semver')

args.option('broker', 'Use custom broker', 'wss://stockings-server.herokuapp.com')
args.option('id', 'Use identity', 'id')

args.command('run','Run daemon.', (_, __, opts) => {
  client = new ws(opts.broker, 'stockings')
  client.on('open', () => {
    console.log(`Connection successed.`)
    let repo = fs.readdirSync('./archives/', { withFileTypes: true })
              .filter(dirent => dirent.isDirectory())
              .map(dirent => dirent.name)
              .map(dirent => fs.readFileSync(`./archives/${dirent}.sign`, {encoding: 'hex'}))
              .join(' ')

    client.send(`stockings:repo ${repo}`)

    client.on('error', () => console.error('Connection closed (ERROR).'))
    client.on('close', () => console.log('Connection closed.'))
    client.on('message', msg => {
      let [name, ver, pubkey, sign, base64] = msg.toString('utf8').split('\n@@@\n')
      console.log(`New archive: ${name}.`)
      if(fs.existsSync(`./archives/${name}.pub`) &&
         fs.readFileSync(`./archives/${name}.pub`) != pubkey
        ) {
          console.error('ERROR: Public key dismatch.')
          return false
        }
      if(crypto.verify('RSA-SHA256', Buffer.from(base64, 'base64'), pubkey, Buffer.from(sign, 'base64'))) {
        if(fs.existsSync(`./archives/${name}.ver`) &&
          fs.readFileSync(`./archives/${name}.ver`, {encoding: 'utf8'}) > ver
          ) {
            console.error("ERROR: Archive is outdated. Reject.")
            return false
        }
        decompress(pubkey, name, ver, sign, base64, false)
        console.log('Decompressed.')
      }
      else {
        console.error('ERROR: Bad signature. Reject.')
      }
    })
    publishArchives(client)
  })
  setInterval(() => client.send('ping'), 8000)
})

args.command('add', 'Add directory to repo', (_, [dir, ver], opts) => addArchive(dir, opts.id, ver))

args.command('remove', 'Remove archive from repo', (_, [name]) => removeArchive(name))

args.command('list', 'List all archives', () => 
  console.log(
    fs.readdirSync('./archives/', { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .join('\n')
  )
)

args.command('get-version', 'Get version of archive', (_, [name]) =>
  console.log(fs.readFileSync(`./archives/${name}.ver`, {encoding: 'utf8'}))
)

let init = () => {
  if(!fs.existsSync('./temp')) {
    fs.mkdirSync('./temp')
  }
  if(!fs.existsSync('./archives')) {
    fs.mkdirSync('./archives')
  }
  if(!fs.existsSync('./ids')) {
    fs.mkdirSync('./ids')
    console.log('Generation default key pair...')
    let passphrase = Math.floor(Math.random() * 1000000).toString(16)
    let {publicKey, privateKey} = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase
      }
    })
    fs.writeFileSync('./ids/id.rsa', privateKey, {encoding: 'utf8'})
    fs.writeFileSync('./ids/id.pub', publicKey, {encoding: 'utf8'})
    fs.writeFileSync('./ids/id.pass', passphrase, {encoding: 'utf8'})
  }
}

init()

let decompress = (pubkey, name, ver, sign, base64, local) => {
    if(!local) {
      fs.writeFileSync(`./temp/${name}`, Buffer.from(base64, 'base64'))
    }
    fs.rmSync(`./archives/${name}`, {recursive: true, force: true})
    fs.mkdirSync(`./archives/${name}`)
    exec(`tar -xf ./temp/${name} -C ./archives/${name}`, taroutput(pubkey, name, ver, sign))
}

let taroutput = (pubkey, name, ver, sign) => (_, out, err) => {
  if(err) {
    console.error(err)
    return
  }
  fs.writeFileSync(`./archives/${name}.sign`, sign, {encoding: 'utf8'})
  fs.writeFileSync(`./archives/${name}.pub`, pubkey, {encoding: 'utf8'})
  fs.writeFileSync(`./archives/${name}.ver`, ver, {encoding: 'utf8'})
  fs.rmSync(`./temp/${name}`)
}

let publishArchives = (con) => {
  fs.readdirSync('./archives/', { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name)
  .forEach(name => {
      let pubkey = fs.readFileSync(`./archives/${name}.pub`, {encoding: 'utf8'})
      let ver = fs.readFileSync(`./archives/${name}.ver`, {encoding: 'utf8'})
      publish(pubkey, name, ver, con)
})
}

let publish = (pubkey, name, ver, con) => {
  exec(`tar -C ./archives/${name} --sort=name --owner=root:0 --group=root:0 --mtime='UTC 2007-09-11' -c . > ./temp/${name}`, (_, __, err) => {
    if(err) {
      console.error(err)
      return
    }
    let base64 = fs.readFileSync(`./temp/${name}`, {encoding: 'base64'})
    let sign = fs.readFileSync(`./archives/${name}.sign`, {encoding: 'utf8'})
    con.send(`${name}\n@@@\n${ver}\n@@@\n${pubkey}\n@@@\n${sign}\n@@@\n${base64}`)
  })
}

let addArchive = (dir, id, ver) => {
  let pubkey = fs.readFileSync(`./ids/${id}.pub`, {encoding: 'utf8'})
  let prvkey = fs.readFileSync(`./ids/${id}.rsa`, {encoding: 'utf8'})
  let passphrase = fs.readFileSync(`./ids/${id}.pass`, {encoding: 'utf8'})
  let name = dir.split('/').filter(el => el.trim().length > 0).pop()
  exec(`tar -C ${dir} --sort=name --owner=root:0 --group=root:0 --mtime='UTC 2002-09-11' -c . > ./temp/${name}`, (_, __, err) => {
    if(err) {
      console.error(err)
    }
    let data = fs.readFileSync(`./temp/${name}`)
    let sign = crypto.sign('RSA-SHA256', data, {key: prvkey, passphrase}).toString('base64')
    decompress(pubkey, name, ver, sign, null, true)
  })
}

let removeArchive = name => {
  fs.rmSync(`./archives/${name}`, {recursive: true, force: true})
  fs.rmSync(`./archives/${name}.pub`)
  fs.rmSync(`./archives/${name}.sign`)
  fs.rmSync(`./archives/${name}.ver`)
}

args.parse(process.argv)

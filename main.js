require('dotenv').config()
const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();

let powerBi = "https://www.workana.com/pt/jobs?language=pt&query=POWER+BI"
let dataScience = "https://www.workana.com/jobs?language=pt&query=data+science&page=2"
let ia = "https://www.workana.com/jobs?language=pt&query=inteligencia+artificial"

let urls = [powerBi, dataScience, ia];

main();

async function main(){
  // faz conexão com bd
  let db = new sqlite3.Database('./db.sqlite');

  db.run(`CREATE TABLE IF NOT EXISTS links (
    link TEXT UNIQUE
  )`, async (err) => {
    if (err) {
      return console.error(err.message);
    }

    // obtém os projetos do bd
    let links = await new Promise((resolve, reject) => {
      db.all('SELECT link FROM links', [], (err, rows) => {
        if (err){
          reject(err);
        }
        let retrievedLinks = rows ? rows.map(row => row.link) : [];
        resolve(retrievedLinks);
      });
    });

    // obtém novos projetos [projeto, link]
    let projects = await getProjects();

    // para cada novo projeto, verifica se já está no db, se não estiver, é adicionado e enviado para o telegram
    for (let project of projects){
      if(!isAlready(project[1], links)){
        await sendMessageToTelegram(project[0]);
        links.push(project[1]);
      }
    }

    // adiciona todos os projetos no db com uma transação
    db.run('BEGIN TRANSACTION');

    let completed = 0;
    for(let link of links){
      db.run(`INSERT OR IGNORE INTO links(link) VALUES(?)`, [link], (err) => {
        if (err) {
          return db.run('ROLLBACK');
        }
    
        completed++;
        if (completed === links.length) {
          db.run('COMMIT');
        }
      });
    }
  });
}

async function getProjects(){
  // inicia navegação
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  let projects = new Array();
  for(let url of urls){
    await page.goto(url);
    // obtém os links de todos os projetos da página
    const links = await page.$$eval('.project-title a', nodes => nodes.map(n => n.href));
    
    // para cada link, obtém o projeto formatado
    for (let link of links){
      let project = await formatProject(browser, link);
      projects.push([project, link]);
    }
  }

  // finaliza navegação
  await browser.close();

  // retorna todos os projetos
  return projects;
};

async function formatProject(browser, link){
  // inicia navegação
  const page = await browser.newPage();
  await page.goto(link);

  // título
  let title = await page.$eval('.title', node => node.textContent);
  title = '<i>' + title.trim() + '</i>';

  // descrição
  let description = await page.$eval('.js-expander-passed', node => node.textContent);
  description = '<b>DESCRIÇÃO</b>' + '\n\n' + description.trim();
  description = description.replace(/\.\.\. leia mais/g, '');
  
  // data de expiração e categorias
  const mt20 = await page.$$eval('.mt20', nodes => nodes.map(n => n.textContent));
  let expiration_date = mt20.filter(data => data.includes("Prazo"))[0];
  expiration_date = expiration_date.trim();

  // let categories = mt20.filter(data => data.includes("Categoria"))[0];
  // categories = categories.split('\n').map(s => s.trim()).join('\n').trim()

  // número de propostas e interessados
  const item_data = await page.$$eval('.item-data .h4', nodes => nodes.map(n => n.textContent));
  let proposal_number = 'Propostas: ' + item_data[2];
  let interested_number = 'Freelancers interessados: ' + item_data[3];
  
  // constrói projeto formatado
  let header = title + '\n\n' + '<b>INFORMAÇÕES</b>'  + '\n\n' + proposal_number + '\n' + interested_number + '\n' + expiration_date ;
  let footer = link;
  let formatProject = header + '\n\n' + description + '\n\n' + footer;
  
  // finaliza navegação
  await page.close();

  // retorna projeto formatado
  return formatProject;
}

function isAlready(projectLink, links){
  // retorna true se link do projeto ja estiver presente no arquivo
  for (let link of links){
    if(projectLink == link) return true;
  }

  // retorna false se não estiver presente
  return false;
}

async function sendMessageToTelegram(message){
  message = encodeURIComponent(message);

  let telegramBotToken = process.env.TOKEN; 
  let chatId = process.env.CHAT_ID;
  let url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage?chat_id=${chatId}&text=${message}&parse_mode=HTML`

  try{
    const request = await fetch(url,{
      method: 'GET',
      redirect: 'follow'
    });
    return request;
  }catch(error){
    console.error('Error:', error);
  }
}
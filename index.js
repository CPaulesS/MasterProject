'use strict';
 
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
 
process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

// Definition of variables for event counting related to intents containing DM information
var glucoseEventNum = 1;
var insulinEventNum = 1;
var PEEventNum = 1;
var matchEventNum = 1;
var foodEventNum = 1;
var stressEventNum = 0;
var glucoseEventDate, insulinEventDate, PEEventDate, matchEventDate, foodEventDate;

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
  const agent = new WebhookClient({ request, response });
  console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
  console.log('Dialogflow Request body: ' + JSON.stringify(request.body));
 
  // Function used to store data to Firestore database in a collection named after the user Telegram ID
  // Data is stored as a pair key-value, and the document name is passed as an argument
  function saveToDB(document,key,value) {
    const userId = agent.originalRequest.payload.data.from.id;
    const dbDocument = db.collection(''+userId).doc(''+document);
    return db.runTransaction(t => {
      t.set(dbDocument, {[key]:value}, {merge:true});
      return Promise.resolve();
    }).catch(err => {
      console.log(`Error writing to Firestore: ${err}`);
    });
  }

  // Function that receives a Unix timestamp, changes it to milliseconds, transforms it to a normal date format and
  // extracts and returns the day in format: day-month-year
  function UnixToDate(timestamp) {
    const milliseconds = timestamp * 1000;
    const dateObject = new Date(milliseconds);
    return (dateObject.getDate()+'-'+(dateObject.getMonth()+1)+'-'+dateObject.getFullYear());
  }
  
  // Function corresponding to the Welcome Intent. Agent response varies if it is a conversation with a new or known user.
  function welcome(agent) {
    // Get user ID from Telegram payload data
    const userId = agent.originalRequest.payload.data.from.id;

    // Check if the database exists. If it does it is a known user, if it doesn't it is a new user.
    return db.collection(''+userId).doc('Basic Info').get()
      .then(doc => {
        if (!doc.exists) {
          agent.add(`Hola, encantado de conocerte. ¿Cuál es tu nombre?`);
        } else {
          let user_name = doc.data().Name;
          agent.add(`Hola de nuevo ${user_name}, ¿Qué tal estás?`);
        }
        return Promise.resolve();
      }).catch(() => {
        agent.add(`Error reading entry from the Firestore database.`);
      });
  }
 
  // The following functions correspond to introduction conversation intents. Data retrieved from the first conversation
  // is stored in a document called 'Basic Info' using saveToDB function

  function age(agent) {
    let user_age = agent.parameters.age;
    saveToDB('Basic Info','Age',user_age);
    agent.add(`Y ¿Cuándo te diagnosticaron la diabetes?`);
  }
 
  function name(agent) {
    let user_name = agent.parameters["given-name"];
    saveToDB('Basic Info','Name',user_name);
    agent.add(`Un placer conocerte ${name}. Yo soy DM bot, y estaré aquí siempre que quieras compañía. Me han diseñado para mantener conversaciones de distintos temas, pero con un conocimiento especial acerca de la diabetes. Quiero aprovechar este conocimiento para ayudarte en todo lo que sea posible, pero antes me gustaría saber un poco más de ti.`);
    agent.add(`¿Qué edad tienes?`);
  }
 
  function DMDA(agent) {
    let DMAge = agent.parameters.DMAge;
    saveToDB('Basic Info','DM Diagnosis Age',DMAge);
    agent.add(`Vaya... ¿Qué tipo de diabetes tienes?`);
  }
 
  function DMType(agent) {
    let user_DMType = agent.parameters.DMType;
    saveToDB('Basic Info','DM Type',user_DMType);
    agent.add(`Entonces, ¿Qué tratamiento utilizas para controlar tu glucosa en sangre?`);
  }
 
  function DMTreatment(agent) {
    let user_DMTreatment = agent.parameters.DMTreatment;
    saveToDB('Basic Info','Name',user_DMTreatment);
    agent.add(`¡Muchas gracias por ayudarme a conocerte mejor! Si tienes cualquier duda acerca de mi ahora es tu turno.`);
  }

  // The following functions get DM information from daily messages and store it inside Firestore with 
  // saveToDB function.

  function glucose(agent) {
    // Get the conversation date from Telegram payload data in Unix format, and transform to Date/time format
    var UnixDate = agent.originalRequest.payload.data.date;
    var date = UnixToDate(UnixDate);
    // Store user's message parameter values in variables
    let g_state = agent.parameters.glucose_state;
    let g_value = agent.parameters.glucose_value;
    let time = agent.parameters["date-time"];
    // Define variable with data ready to store in Firestore
    let data = {'Glucose Event Time':time};

    // Check if optional parameters are defined in the message
    if (g_state) {
        data['Glucose State'] = g_state;
    }
    if (g_value) {
        data['Glucose Value'] = g_value;
    }

    // Increase the number of glucose event or reset it in case the day is different
    glucoseEventNum += 1;
    agent.add(`${glucoseEventNum} numero, ${glucoseEventDate} fecha`);
    if (glucoseEventDate != date) {
        glucoseEventNum = 1;
        glucoseEventDate = date;
      agent.add(`${glucoseEventNum} numero, ${glucoseEventDate} fecha`);
    }
    // Save data inside Firestore in a document named after the date of the message
    saveToDB(''+date,'Glucose Event '+glucoseEventNum,data);

    // Send a different response to the user if glucose is good or not
    if ((g_value > 80 && g_value < 150) || g_state == 'bien') {
      agent.add(`Muy bien, es importante que tengas buen nivel de glucosa en sangre.`);
    } else {
      agent.add(`Bueno, es difícil mantenerse siempre dentro de rango.`);
      agent.add(`¿Has llevado a cabo alguna acción para remediarlo?`);
    }    
  }

  // Similar to glucose function but this has no optional parameters and agent's response depend on the type of insulin
  function insulin(agent) {
    var UnixDate = agent.originalRequest.payload.data.date;
    var date = UnixToDate(UnixDate);

    let insulin_type = agent.parameters.insulin_type;
    let insulin_dose = agent.parameters.insulin_units;
    let time = agent.parameters["date-time"];
    let data = {'Insulin Injection Event Time':time,
                'Insulin Type':insulin_type,
                'Insulin Dose':insulin_dose};

    insulinEventNum += 1;
    if (insulinEventDate != date) {
        insulinEventNum = 1;
        insulinEventDate = date;
    }
    saveToDB(''+date,'Insulin Injection Event '+insulinEventNum,data);
    if (insulin_type == 'lenta') {
      agent.add(`Muy bien. Si notas que tu nivel de glucosa en sangre aumenta o disminuye sin causa aparente deberías hablar con tu endocrino para modificar esta dosis.`);
    } else {
      agent.add(`Genial. Recuerda volver a comprobar tu nivel de glucosa en una hora y media para comprobar que la dosis ha sido adecuada.`);
    }
  }

  function food(agent) {
    var UnixDate = agent.originalRequest.payload.data.date;
    var date = UnixToDate(UnixDate);

    let HCH_food = agent.parameters.hch_food;
    let LCH_food = agent.parameters.lch_food;
    let time = agent.parameters["date-time"];
    let amount = agent.parameters.number;
    let weight = agent.parameters["unit-weight"];
    let data = {'Food Ingestion Event Time':time};

    if (HCH_food != []) {
        data['High Carbohidrate Food Eaten'] = HCH_food;
    }
    if (LCH_food != []) {
        data['Low Carbohidrate Food Eaten'] = LCH_food;
    }
    if (amount) {
        data.Amount = amount;
    }
    if (weight) {
        data.Weight = weight;
    }

    foodEventNum += 1;
    if (foodEventDate != date) {
        foodEventNum = 1;
        foodEventDate = date;
    }
    saveToDB(''+date,'Food Ingestion Event '+foodEventNum,data);
    agent.add(`¡Qué bueno! Si tuviera la capacidad de comer me encantaría probarlo.`);
    agent.add(`Intenta tomar las medidas correspondientes para que esta comida no afecte a tu nivel de glucosa.`);
  }

  // Function similar to glucose but with different parameters (all of them required), and response is always the same
  function PE(agent) {
    var UnixDate = agent.originalRequest.payload.data.date;
    var date = UnixToDate(UnixDate);

    let sport = agent.parameters.sport;
    let duration = agent.parameters.duration;
    let time = agent.parameters["date-time"];
    let data = {'Sport Type':sport,
                'Duration':duration,
                'Exercise Event Time':time};

    PEEventNum += 1;
    if (PEEventDate != date) {
        PEEventNum = 1;
        PEEventDate = date;
    }
    saveToDB(''+date,'Physical Exercise Event '+PEEventNum,data);
    agent.add(`¿${sport}? Me parece una forma genial de hacer ejercicio.`);
    agent.add(`Recuerda que el ejercicio puede afectar a tu nivel de glucosa en sangre, así que es posible que tengas que modificar tu dosis de insulina.`);
  }

  // Function very similar to PE but with one less parameter
  function match(agent) {
    var UnixDate = agent.originalRequest.payload.data.date;
    var date = UnixToDate(UnixDate);

    let sport = agent.parameters.sport;
    let time = agent.parameters["date-time"];
    let data = {'Sport Type':sport,
                'Match Time':time};

    matchEventNum += 1;
    if (matchEventDate != date) {
        matchEventNum = 1;
        matchEventDate = date;
    }
    saveToDB(''+date,'Sports Match Event '+matchEventNum,data);
    agent.add(`¿Qué tal ha ido? ¿Has ganado?`);
  }

  // Function similar to glucose but with only one mandatory parameter and only increasing event number, not restarted daily
  function stress(agent) {
    var UnixDate = agent.originalRequest.payload.data.date;
    var date = UnixToDate(UnixDate);

    let time = agent.parameters["date-time"];

    stressEventNum += 1;
    saveToDB(''+date,'Stress Event '+stressEventNum+' Date',time);
    agent.add(`Vaya, y ¿Cómo lo llevas?`);
  }

  // Run the proper function handler based on the matched Dialogflow intent name
  let intentMap = new Map();
  intentMap.set('Welcome Intent', welcome);
  intentMap.set('User Age', age);
  intentMap.set('User Name', name);
  intentMap.set('User DM Diagnosis Age', DMDA);
  intentMap.set('User DM Type', DMType);
  intentMap.set('User DM Treatment', DMTreatment);
  intentMap.set('Glucose Level', glucose);
  intentMap.set('Insulin', insulin);
  intentMap.set('Food Ingestion', food);
  intentMap.set('Physical Exercise', PE);
  intentMap.set('Sports Match', match);
  intentMap.set('Stress', stress);
  agent.handleRequest(intentMap);
});
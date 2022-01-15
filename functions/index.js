"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const {WebhookClient} = require("dialogflow-fulfillment");

const rp = require("request-promise");

process.env.DEBUG = "dialogflow:debug"; // enables lib debugging statements
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

// Definition of variables for event counting related to intents containing DM information
let glucoseEventNum = 1;
let insulinEventNum = 1;
let PEEventNum = 1;
let matchEventNum = 1;
let foodEventNum = 1;
let stressEventNum = 0;
let glucoseEventDate; let insulinEventDate; let PEEventDate; let matchEventDate; let foodEventDate;

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
  // const test = callModel("How are you?", response => {
  //   console.log(response);
  // });

  const agent = new WebhookClient({request, response});
  console.log("Dialogflow Request headers: " + JSON.stringify(request.headers));
  console.log("Dialogflow Request body: " + JSON.stringify(request.body));

  // Function used to store data to Firestore database in a collection named after the user Telegram ID
  // Data is stored as a pair key-value, and the document name is passed as an argument
  async function saveToDB(document, key, value){
    let userId = agent.originalRequest.payload.data.from.id;
    const dbDocument = db.collection(""+userId).doc(""+document);
    await dbDocument.set({
      [key]:value
    }, { merge: true });
  }

  // Function that receives a Unix timestamp, changes it to milliseconds, transforms it to a normal date format and
  // extracts and returns the day in format: day-month-year
  function UnixToDate(timestamp) {
    const milliseconds = timestamp * 1000;
    const dateObject = new Date(milliseconds);
    return (dateObject.getDate()+"-"+(dateObject.getMonth()+1)+"-"+dateObject.getFullYear());
  }

  function callModel(question, callback) {
    const promise = new Promise((resolve) => {
      let data = {message:question};

      console.log(`callModel: ${JSON.stringify(data)}`);
      
      try {
        rp({
          method: "POST",
          uri: "https://e8bd-46-24-247-212.ngrok.io/api",
          body: data,
          headers: {
            "Content-Type": "application/json"
          },
          json: true
        }).then(answer => {
          console.log(`API call answer: ${JSON.stringify(answer)}`);
          callback(answer.response);
          resolve();
        }).catch(function (err) {
          console.log(`API call error: ${err}`);
          resolve();
        });
      } catch (error) {
        console.log(`API error: ${error}`);
        resolve();
      }
    });

    return promise;
  }

  // Function corresponding to the Welcome Intent. Agent response varies if it is a conversation with a new or known user.
  function welcome(agent) {
    // Get user ID from Telegram payload data
    const userId = agent.originalRequest.payload.data.from.id;

    // Check if the database exists. If it does it is a known user, if it doesn't it is a new user.
    return db.collection(""+userId).doc("Basic Info").get()
        .then((doc) => {
          if (!doc.exists) {
            agent.add("Hi, nice to meet you. What's your name?");
          } else {
            const user_name = doc.data().Name;
            agent.add(`Hi again ${user_name}, how are you today?`);
          }
          return Promise.resolve();
        }).catch(() => {
          agent.add("Error reading entry from the Firestore database.");
        });
  }

  // The following functions correspond to introduction conversation intents. Data retrieved from the first conversation
  // is stored in a document called 'Basic Info' using saveToDB function

  function age(agent) {
    const user_age = agent.parameters.age;
    saveToDB("Basic Info", "Age", user_age);
    agent.add("So, when were you diagnosed your diabetes?");
  }

  function name(agent) {
    const user_name = agent.parameters["given-name"];
    saveToDB("Basic Info", "Name", user_name);
    agent.add(`It's a pleasure ${name}. I am DM bot, and I will be here for you whenever you want to chat. 
    I've been created to have conversations about different topics, but with a special knowledge about diabetes. 
    I want to use all my knowledge about diabetes to help you in anything I can, but before I would like to know a little bit more about you.`);
    agent.add("How old are you?");
  }

  function DMDA(agent) {
    const DMAge = agent.parameters.DMAge;
    saveToDB("Basic Info", "DM Diagnosis Age", DMAge);
    agent.add("Oh... What type is your diabetes?");
  }

  function DMType(agent) {
    const user_DMType = agent.parameters.DMType;
    saveToDB("Basic Info", "DM Type", user_DMType);
    agent.add("Then, what kind of treatment do you use to control your blood glucose level?");
  }

  function DMTreatment(agent) {
    const user_DMTreatment = agent.parameters.DMTreatment;
    saveToDB("Basic Info", "Name", user_DMTreatment);
    agent.add("Thank you very much for helping me to get to know you better! If you have any question about me now is the time to ask them.");
  }

  // The following functions get DM information from daily messages and store it inside Firestore with
  // saveToDB function.

  function glucose(agent) {
    // Get the conversation date from Telegram payload data in Unix format, and transform to Date/time format
    const UnixDate = agent.originalRequest.payload.data.date;
    const date = UnixToDate(UnixDate);
    // Store user's message parameter values in variables
    const g_state = agent.parameters.glucose_state;
    const g_value = agent.parameters.glucose_value;
    const time = agent.parameters["date-time"];
    // Define variable with data ready to store in Firestore
    const data = {"Glucose Event Time": time};

    // Check if optional parameters are defined in the message
    if (g_state) {
      data["Glucose State"] = g_state;
    }
    if (g_value) {
      data["Glucose Value"] = g_value;
    }

    // Increase the number of glucose event or reset it in case the day is different
    glucoseEventNum += 1;
    if (glucoseEventDate != date) {
      glucoseEventNum = 1;
      glucoseEventDate = date;
    }
    // Save data inside Firestore in a document named after the date of the message
    saveToDB(""+date, "Glucose Event "+glucoseEventNum, data);

    // Send a different response to the user if glucose is good or not
    //if ((g_value > 80 && g_value < 150) || g_state == "bien") {
    //  agent.add("Muy bien, es importante que tengas buen nivel de glucosa en sangre.");
    //} else {
    //  agent.add("Bueno, es difícil mantenerse siempre dentro de rango.");
    //  agent.add("¿Has llevado a cabo alguna acción para remediarlo?");
    //}
  }

  // Similar to glucose function but this has no optional parameters and agent's response depend on the type of insulin
  function insulin(agent) {
    const UnixDate = agent.originalRequest.payload.data.date;
    const date = UnixToDate(UnixDate);

    const insulin_type = agent.parameters.insulin_type;
    const insulin_dose = agent.parameters.insulin_units;
    const time = agent.parameters["date-time"];
    const data = {"Insulin Injection Event Time": time,
      "Insulin Type": insulin_type,
      "Insulin Dose": insulin_dose};

    insulinEventNum += 1;
    if (insulinEventDate != date) {
      insulinEventNum = 1;
      insulinEventDate = date;
    }
    saveToDB(""+date, "Insulin Injection Event "+insulinEventNum, data);
    //if (insulin_type == "lenta") {
    //  agent.add("Muy bien. Si notas que tu nivel de glucosa en sangre aumenta o disminuye sin causa aparente deberías hablar con tu endocrino para modificar esta dosis.");
    //} else {
    //  agent.add("Genial. Recuerda volver a comprobar tu nivel de glucosa en una hora y media para comprobar que la dosis ha sido adecuada.");
    //}
  }

  function food(agent) {
    const UnixDate = agent.originalRequest.payload.data.date;
    const date = UnixToDate(UnixDate);

    const HCH_food = agent.parameters.hch_food;
    const LCH_food = agent.parameters.lch_food;
    const time = agent.parameters["date-time"];
    const amount = agent.parameters.number;
    const weight = agent.parameters["unit-weight"];
    const data = {"Food Ingestion Event Time": time};

    if (HCH_food != []) {
      data["High Carbohidrate Food Eaten"] = HCH_food;
    }
    if (LCH_food != []) {
      data["Low Carbohidrate Food Eaten"] = LCH_food;
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
    saveToDB(""+date, "Food Ingestion Event "+foodEventNum, data);
    //agent.add("¡Qué bueno! Si tuviera la capacidad de comer me encantaría probarlo.");
    //agent.add("Intenta tomar las medidas correspondientes para que esta comida no afecte a tu nivel de glucosa.");
  }

  // Function similar to glucose but with different parameters (all of them required), and response is always the same
  function PE(agent) {
    const UnixDate = agent.originalRequest.payload.data.date;
    const date = UnixToDate(UnixDate);

    const sport = agent.parameters.sport;
    const duration = agent.parameters.duration;
    const time = agent.parameters["date-time"];
    const data = {"Sport Type": sport,
      "Duration": duration,
      "Exercise Event Time": time};

    PEEventNum += 1;
    if (PEEventDate != date) {
      PEEventNum = 1;
      PEEventDate = date;
    }
    saveToDB(""+date, "Physical Exercise Event "+PEEventNum, data);
    //agent.add(`¿${sport}? Me parece una forma genial de hacer ejercicio.`);
    //agent.add("Recuerda que el ejercicio puede afectar a tu nivel de glucosa en sangre, así que es posible que tengas que modificar tu dosis de insulina.");
  }

  // Function very similar to PE but with one less parameter
  function match(agent) {
    const UnixDate = agent.originalRequest.payload.data.date;
    const date = UnixToDate(UnixDate);

    const sport = agent.parameters.sport;
    const time = agent.parameters["date-time"];
    const data = {"Sport Type": sport,
      "Match Time": time};

    matchEventNum += 1;
    if (matchEventDate != date) {
      matchEventNum = 1;
      matchEventDate = date;
    }
    saveToDB(""+date, "Sports Match Event "+matchEventNum, data);
    //agent.add("¿Qué tal ha ido? ¿Has ganado?");
  }

  // Function similar to glucose but with only one mandatory parameter and only increasing event number, not restarted daily
  function stress(agent) {
    const UnixDate = agent.originalRequest.payload.data.date;
    const date = UnixToDate(UnixDate);

    const message = agent.originalRequest.payload.data.text;

    const time = agent.parameters["date-time"];

    stressEventNum += 1;
    saveToDB(""+date, "Stress Event "+stressEventNum+" Date", time);
    
    return callModel(message, res => agent.add(res));
  }

  // Run the proper function handler based on the matched Dialogflow intent name
  const intentMap = new Map();
  intentMap.set("Welcome Intent", welcome);
  intentMap.set("User Age", age);
  intentMap.set("User Name", name);
  intentMap.set("User DM Diagnosis Age", DMDA);
  intentMap.set("User DM Type", DMType);
  intentMap.set("User DM Treatment", DMTreatment);
  intentMap.set("Glucose Level", glucose);
  intentMap.set("Insulin", insulin);
  intentMap.set("Food Ingestion", food);
  intentMap.set("Physical Exercise", PE);
  intentMap.set("Sports Match", match);
  intentMap.set("Stress", stress);
  agent.handleRequest(intentMap);
});

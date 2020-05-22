import * as Admin from 'firebase-admin';
import * as Express from 'express';
import * as BodyParser from 'body-parser';

interface Question {
  question: string;
  answer: string;
}

interface Section {
  name: string;
  questions: Question[];
}

interface Questionnaire {
  uuid: string;
  name: string;
  sections: Section[];
}

interface QuestionnaireResponse {
  [key: string]: Questionnaire;
}

const api = '/api';
const v1 = `${api}/v1`;
const base = v1;

const admin = Admin.initializeApp({
  credential: Admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  databaseURL: process.env.DATABASE_URL
});

const verifyToken = async (jwt: string): Promise<boolean> => {
  return admin
    .auth()
    .verifyIdToken(jwt)
    .then((_decodedIdToken: Admin.auth.DecodedIdToken) => {
      return true;
    })
    .catch(() => {
      return false;
    });
};

const extractJwt = (auth: string) => {
  return auth.split(' ')[1];
};

const extractAndVerifyJwt = async (request: Express.Request) => {
  const auth = request.headers.authorization;
  if (auth) {
    const token = extractJwt(auth);
    return verifyToken(token)
      .then((verified) => {
        if (verified) {
          return true;
        } else {
          return false;
        }
      })
      .catch(() => {
        return false;
      });
  } else {
    return Promise.resolve(false);
  }
};

const refOnceVal = async <T>(ref: string) => {
  return admin
    .database()
    .ref(ref)
    .once('value')
    .then((snapshot) => {
      return snapshot.val() as T;
    });
};

const getQuestionnaires = () => {
  return refOnceVal<QuestionnaireResponse>('/questionnaires');
};

const getQuestionnaire = (questionnaireId: string) => {
  return refOnceVal<Questionnaire>(`/questionnaires/${questionnaireId}`);
};

const postQuestionnaire = async (questionnaire: Questionnaire) => {
  return admin
    .database()
    .ref('/questionnaires')
    .push(questionnaire)
    .then((ref) => ref.key);
};

const putQuestionnaire = (
  questionnaireId: string,
  questionnaire: Questionnaire
) => {
  return admin
    .database()
    .ref(`/questionnaires/${questionnaireId}`)
    .set(questionnaire);
};

const deleteQuestionnaire = (questionnaireId: string) => {
  return admin.database().ref(`/questionnaires/${questionnaireId}`).remove();
};

const questionnaireRequestHandler = (
  request: Express.Request,
  response: Express.Response,
  fetchFn: (questionnaireId?: string) => Promise<any>,
  questionnaireId?: string
) => {
  extractAndVerifyJwt(request).then((verified) => {
    if (verified) {
      const fetch = () => {
        if (questionnaireId) {
          return fetchFn(questionnaireId);
        } else {
          return fetchFn();
        }
      };

      fetch()
        .then((responseData) => {
          response.json(responseData);
        })
        .catch(() => {
          response.sendStatus(500);
        });
    } else {
      response.sendStatus(401);
    }
  });
};

const server = Express();
server.use(BodyParser.json());

server.get(`${base}/questionnaires`, (request, response) => {
  questionnaireRequestHandler(request, response, getQuestionnaires);
});

server.get(`${base}/questionnaires/:questionnaireId`, (request, response) => {
  const questionnaireId = request.params.questionnaireId;
  questionnaireRequestHandler(
    request,
    response,
    getQuestionnaire,
    questionnaireId
  );
});

server.post(`${base}/questionnaires`, (request, response) => {
  extractAndVerifyJwt(request).then((verified) => {
    if (verified) {
      const questionnaire: Questionnaire = request.body;
      postQuestionnaire(questionnaire)
        .then((key) => {
          response.json({
            key
          });
        })
        .catch(() => {
          response.sendStatus(500);
        });
    } else {
      response.sendStatus(401);
    }
  });
});

server.put(`${base}/questionnaires/:questionnaireId`, (request, response) => {
  extractAndVerifyJwt(request).then((verified) => {
    if (verified) {
      const questionnaireId = request.params.questionnaireId;
      const questionnaire: Questionnaire = request.body;
      putQuestionnaire(questionnaireId, questionnaire)
        .then(() => {
          response.json();
        })
        .catch(() => {
          response.sendStatus(500);
        });
    } else {
      response.sendStatus(401);
    }
  });
});

server.delete(
  `${base}/questionnaires/:questionnaireId`,
  (request, response) => {
    extractAndVerifyJwt(request).then((verified) => {
      if (verified) {
        const questionnaireId = request.params.questionnaireId;
        deleteQuestionnaire(questionnaireId)
          .then(() => {
            response.json();
          })
          .catch(() => {
            response.sendStatus(500);
          });
      } else {
        response.sendStatus(401);
      }
    });
  }
);

const port = +process.env.PORT | 5000;
server.listen(port, () => {
  console.log(`Tap Vote 🚀 server started on port ${port}`);
});

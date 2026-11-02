#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "httplib.h"
#include "json.hpp"
#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>

using namespace std;
using json = nlohmann::json;

// MediQ educational backend: the data structures are implemented directly in C++.
struct Patient {
    int id = 0, age = 0, token = 0;
    string name, problem, status, category;
    int updatedOrder = 0;
};
struct CompletedNode {
    int id, token;
    string name;
    CompletedNode* next;
    CompletedNode(int i, int t, const string& n): id(i), token(t), name(n), next(nullptr) {}
};

Patient patients[100];
int patientCount = 0, tokenCount = 1, updateCounter = 0;
int normalQueue[100], frontQ = 0, rearQ = -1;
int emergencyQueue[100], emergencyFront = 0, emergencyRear = -1;
int recentStack[100], top = -1;
CompletedNode* completedHead = nullptr;
vector<int> completedOrder;

void enqueueNormal(int pos) { if (rearQ < 99) normalQueue[++rearQ] = pos; }
void enqueueEmergency(int pos) { if (emergencyRear < 99) emergencyQueue[++emergencyRear] = pos; }
bool normalEmpty() { return frontQ > rearQ; }
bool emergencyEmpty() { return emergencyFront > emergencyRear; }
void pushRecent(int pos) { if (top < 99) recentStack[++top] = pos; }
void addCompleted(int pos) {
    CompletedNode* n = new CompletedNode(patients[pos].id, patients[pos].token, patients[pos].name);
    if (!completedHead) completedHead = n;
    else { CompletedNode* p = completedHead; while (p->next) p = p->next; p->next = n; }
    completedOrder.push_back(pos);
}
json patientJson(int i) {
    const Patient& p = patients[i];
    return {{"id",p.id},{"age",p.age},{"token",p.token},{"name",p.name},
            {"problem",p.problem},{"status",p.status},{"category",p.category},
            {"updatedOrder",p.updatedOrder}};
}
json errorJson(const string& msg) { return {{"message",msg}}; }
void saveRecords() {
    ofstream f("patients.txt", ios::trunc);
    for (int i=0;i<patientCount;i++) {
        const auto& p=patients[i];
        // Pipe-delimited format supports spaces in names and problems.
        f << p.id << '|' << p.age << '|' << p.token << '|' << p.category << '|'
          << p.status << '|' << p.updatedOrder << '|' << p.name << '|' << p.problem << '\n';
    }
}
void loadRecords() {
    ifstream f("patients.txt");
    string line;
    while (getline(f,line) && patientCount<100) {
        vector<string> parts; string part; size_t start=0;
        while (true) { size_t k=line.find('|',start); if(k==string::npos){parts.push_back(line.substr(start));break;} parts.push_back(line.substr(start,k-start)); start=k+1; }
        if(parts.size()<8) continue;
        try {
            Patient p; p.id=stoi(parts[0]); p.age=stoi(parts[1]); p.token=stoi(parts[2]);
            p.category=parts[3]; p.status=parts[4]; p.updatedOrder=stoi(parts[5]); p.name=parts[6]; p.problem=parts[7];
            int pos=patientCount; patients[patientCount++]=p;
            tokenCount=max(tokenCount,p.token+1); updateCounter=max(updateCounter,p.updatedOrder);
            if(p.status=="Waiting") enqueueNormal(pos);
            else if(p.status=="Emergency Waiting") enqueueEmergency(pos);
            else if(p.status=="Under Consultation") { /* Keep status; do not silently requeue a patient */ }
            else if(p.status=="Completed") { addCompleted(pos); pushRecent(pos); }
        } catch(...) { /* Ignore malformed lines in this educational demo. */ }
    }
}
int findPatient(int id) { for(int i=0;i<patientCount;i++) if(patients[i].id==id) return i; return -1; }
json allPatients() { json arr=json::array(); for(int i=0;i<patientCount;i++) arr.push_back(patientJson(i)); return {{"patients",arr}}; }

int main() {
    loadRecords();
    httplib::Server server;
    server.set_payload_max_length(1024*1024);
    server.set_mount_point("/", "./web");
    server.set_default_headers({{"Access-Control-Allow-Origin","*"},{"Access-Control-Allow-Headers","Content-Type"},{"Access-Control-Allow-Methods","GET, POST, OPTIONS"}});
    server.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res){ res.status=204; });
    server.Get("/api/patients", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(allPatients().dump(), "application/json");
    });
    server.Post("/api/register", [](const httplib::Request& req, httplib::Response& res) {
        try {
            json body=json::parse(req.body);
            if(patientCount>=100) { res.status=400; res.set_content(errorJson("Patient capacity (100) reached.").dump(),"application/json"); return; }
            int id=body.at("id").get<int>(), age=body.at("age").get<int>();
            string name=body.at("name").get<string>(), problem=body.at("problem").get<string>();
            string category=body.at("category").get<string>();
            if(id<=0||age<0||age>120||name.empty()||problem.empty()||(category!="normal"&&category!="emergency")) {
                res.status=400; res.set_content(errorJson("Enter a valid ID, name, age, health problem, and category.").dump(),"application/json"); return;
            }
            if(findPatient(id)>=0) { res.status=400; res.set_content(errorJson("That patient ID already exists. Please use a unique ID.").dump(),"application/json"); return; }
            int pos=patientCount++;
            Patient p; p.id=id;p.age=age;p.name=name;p.problem=problem;p.category=category;p.token=tokenCount++;
            p.status=(category=="emergency")?"Emergency Waiting":"Waiting"; p.updatedOrder=++updateCounter; patients[pos]=p;
            if(category=="emergency") enqueueEmergency(pos); else enqueueNormal(pos);
            res.set_content(json{{"message","Patient registered"},{"patient",patientJson(pos)}}.dump(),"application/json");
        } catch(...) { res.status=400; res.set_content(errorJson("Invalid request data.").dump(),"application/json"); }
    });
    server.Post("/api/call-next", [](const httplib::Request&, httplib::Response& res) {
        int pos=-1;
        if(!emergencyEmpty()) pos=emergencyQueue[emergencyFront++];
        else if(!normalEmpty()) pos=normalQueue[frontQ++];
        if(pos<0) { res.status=404;res.set_content(errorJson("No patients are waiting.").dump(),"application/json");return; }
        patients[pos].status="Under Consultation"; patients[pos].updatedOrder=++updateCounter;
        res.set_content(json{{"message","Patient called"},{"patient",patientJson(pos)}}.dump(),"application/json");
    });
    server.Post("/api/complete", [](const httplib::Request& req, httplib::Response& res) {
        try {
            json body=json::parse(req.body); int id=body.at("id").get<int>(); int pos=findPatient(id);
            if(pos<0) {res.status=404;res.set_content(errorJson("Patient ID not found.").dump(),"application/json");return;}
            if(patients[pos].status!="Under Consultation") {res.status=400;res.set_content(errorJson("Only a patient under consultation can be marked completed.").dump(),"application/json");return;}
            patients[pos].status="Completed"; patients[pos].updatedOrder=++updateCounter;
            addCompleted(pos);pushRecent(pos);
            res.set_content(json{{"message","Consultation completed for "+patients[pos].name+"."},{"patient",patientJson(pos)}}.dump(),"application/json");
        } catch(...) {res.status=400;res.set_content(errorJson("Invalid request data.").dump(),"application/json");}
    });
    server.Get("/api/history", [](const httplib::Request&, httplib::Response& res) {
        json completed=json::array(), recent=json::array();
        for(int pos:completedOrder) completed.push_back(patientJson(pos));
        for(int i=top;i>=0;i--) recent.push_back(patientJson(recentStack[i]));
        res.set_content(json{{"completed",completed},{"recent",recent}}.dump(),"application/json");
    });
    cout << "========================================\n";
    cout << " MediQ web app is starting...\n";
    cout << " Open http://localhost:8080 in your browser\n";
    cout << " Press Ctrl+C to stop the server.\n";
    cout << "========================================\n";
    server.listen("127.0.0.1",8080);
    saveRecords();
    while(completedHead){CompletedNode* n=completedHead;completedHead=completedHead->next;delete n;}
    return 0;
}
